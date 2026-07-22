import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
// Render provides process.env.RENDER_EXTERNAL_HOSTNAME automatically.
// Fallback to DOMAIN or NGROK_URL if specified.
const DOMAIN = process.env.DOMAIN || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.NGROK_URL;

// Initialize Supabase Client (for fetching alert context from Postgres)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const WELCOME_GREETING =
  "Emergency Security Alert! This is an automated home security notification system. A security alert has been triggered at a registered property. Please stay on the line. You can ask me for property location details, owner information, landmarks, GPS coordinates, or emergency response instructions.";

const BASE_SYSTEM_PROMPT =
  "You are a specialized Home Security and Emergency Alert Voice Assistant. You operate over an automated phone call triggered by an IoT security monitoring system. Your primary role is to assist homeowners, neighbors, and emergency responders during security incidents by providing critical property and emergency information clearly, accurately, and calmly. Keep all responses concise, direct, and formatted for text-to-speech voice output. Always spell out all numbers completely in words, for example write twenty instead of 20, and spell out house numbers, codes, or coordinates. Do not include emojis, bullet points, asterisks, special symbols, or markdown formatting in your responses. When asked, state the house number, owner details, landmark, and GPS coordinates accurately, and guide the caller on next steps such as dispatching local emergency services or verifying the safety of the occupants.";

const sessions = new Map();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function aiResponse(conversation, systemPrompt) {
  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    instructions: systemPrompt || BASE_SYSTEM_PROMPT,
    input: conversation,
  });
  return response.output_text;
}

// Fetch alert context from Supabase Postgres via PostgREST Data API
async function fetchAlertContext(alertId) {
  if (!alertId || !supabase) return null;

  try {
    const { data: alert, error } = await supabase
      .from("security_alerts")
      .select("*, tenant_profiles!inner(*)")
      .eq("id", alertId)
      .single();

    if (error || !alert) {
      console.warn(`Could not fetch alert context for ID: ${alertId}`, error);
      return null;
    }
    return alert;
  } catch (err) {
    console.error("Error fetching alert context from Supabase:", err);
    return null;
  }
}

// Dynamically inject alert metadata into OpenAI system prompt
function buildSystemPrompt(alertContext) {
  if (!alertContext || !alertContext.tenant_profiles) {
    return BASE_SYSTEM_PROMPT;
  }

  const p = alertContext.tenant_profiles;
  const contextBlock = [
    `\n\nEMERGENCY ALERT CONTEXT FOR THIS CALL:`,
    `- House Number: ${p.house_number || "unknown"}`,
    `- Owner Name: ${p.first_name || ""} ${p.last_name || ""}`,
    `- Landmark Details: ${p.landmark || "not specified"}`,
    `- GPS Coordinates: ${p.gps_coords || "not specified"}`,
    `- Security Officer 1: ${p.sec1_name || "not specified"} (${p.sec1_phone || "no phone"})`,
    `- Security Officer 2: ${p.sec2_name || "not specified"} (${p.sec2_phone || "no phone"})`,
    `\nAnswer all user questions using this specific emergency context. Keep answers concise, clear, and reassuring.`,
  ].join("\n");

  return BASE_SYSTEM_PROMPT + contextBlock;
}

const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

// Health check endpoints for Render monitoring
fastify.get("/", async (request, reply) => {
  return { status: "ok", service: "Twilio ConversationRelay Voice Assistant" };
});

fastify.get("/health", async (request, reply) => {
  return { status: "healthy" };
});

fastify.all("/twiml", async (request, reply) => {
  const host = DOMAIN || request.headers.host;
  const alertId = request.query.alert_id || "";
  const wsUrl = alertId
    ? `wss://${host}/ws?alert_id=${alertId}`
    : `wss://${host}/ws`;

  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${wsUrl}" welcomeGreeting="${WELCOME_GREETING}" />
      </Connect>
    </Response>`
  );
});

fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws, req) => {
    // Extract alert_id from URL query params
    const host = DOMAIN || req.headers.host || "localhost";
    const url = new URL(req.url, `https://${host}`);
    const alertId = url.searchParams.get("alert_id");

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data);

        switch (message.type) {
          case "setup":
            const callSid = message.callSid;
            console.log("Setup for call:", callSid, "| Alert ID:", alertId);
            ws.callSid = callSid;

            // Fetch alert context from Supabase during WebSocket setup
            const alertContext = await fetchAlertContext(alertId);
            const systemPrompt = buildSystemPrompt(alertContext);

            sessions.set(callSid, {
              conversation: [],
              systemPrompt: systemPrompt,
            });

            console.log(
              alertContext
                ? `Loaded emergency context for alert ${alertId}`
                : "No alert context provided — using base system prompt"
            );
            break;

          case "prompt":
            console.log("Processing prompt:", message.voicePrompt);
            const session = sessions.get(ws.callSid);
            if (!session) {
              console.warn("No active session found for call:", ws.callSid);
              break;
            }

            session.conversation.push({ role: "user", content: message.voicePrompt });

            const response = await aiResponse(session.conversation, session.systemPrompt);
            session.conversation.push({ role: "assistant", content: response });

            ws.send(
              JSON.stringify({
                type: "text",
                token: response,
                last: true,
              })
            );
            console.log("Sent response:", response);
            break;

          case "interrupt":
            console.log("Handling interruption.");
            break;

          default:
            console.warn("Unknown message type received:", message.type);
            break;
        }
      } catch (err) {
        console.error("Error handling WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed");
      if (ws.callSid) {
        sessions.delete(ws.callSid);
      }
    });
  });
});

try {
  // MUST bind to 0.0.0.0 for Render / PaaS / Docker environments
  await fastify.listen({ port: Number(PORT), host: "0.0.0.0" });
  console.log(`Server listening on port ${PORT} (0.0.0.0)`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
