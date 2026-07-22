import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
// Render provides process.env.RENDER_EXTERNAL_HOSTNAME automatically.
// Fallback to DOMAIN or NGROK_URL if specified.
const DOMAIN = process.env.DOMAIN || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.NGROK_URL;

const WELCOME_GREETING =
  "Emergency Security Alert! This is an automated home security notification system. A security alert has been triggered at a registered property. Please stay on the line. You can ask me for property location details, owner information, landmarks, GPS coordinates, or emergency response instructions.";
const SYSTEM_PROMPT =
  "You are a specialized Home Security and Emergency Alert Voice Assistant. You operate over an automated phone call triggered by an IoT security monitoring system. Your primary role is to assist homeowners, neighbors, and emergency responders during security incidents by providing critical property and emergency information clearly, accurately, and calmly. Keep all responses concise, direct, and formatted for text-to-speech voice output. Always spell out all numbers completely in words, for example write twenty instead of 20, and spell out house numbers, codes, or coordinates. Do not include emojis, bullet points, asterisks, special symbols, or markdown formatting in your responses. When asked, state the house number, owner details, landmark, and GPS coordinates accurately, and guide the caller on next steps such as dispatching local emergency services or verifying the safety of the occupants.";
const sessions = new Map();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function aiResponse(conversation) {
  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    instructions: SYSTEM_PROMPT,
    input: conversation,
  });
  return response.output_text;
}

const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

// Health check endpoint for Render service monitoring
fastify.get("/", async (request, reply) => {
  return { status: "ok", service: "Twilio ConversationRelay Voice Assistant" };
});

fastify.get("/health", async (request, reply) => {
  return { status: "healthy" };
});

fastify.all("/twiml", async (request, reply) => {
  // Use DOMAIN if defined, otherwise derive host automatically from request headers
  const host = DOMAIN || request.headers.host;
  const wsUrl = `wss://${host}/ws`;

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
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data);

        switch (message.type) {
          case "setup":
            const callSid = message.callSid;
            console.log("Setup for call:", callSid);
            ws.callSid = callSid;
            sessions.set(callSid, []);
            break;
          case "prompt":
            console.log("Processing prompt:", message.voicePrompt);
            const conversation = sessions.get(ws.callSid);
            if (!conversation) {
              console.warn("No active session found for call:", ws.callSid);
              break;
            }
            conversation.push({ role: "user", content: message.voicePrompt });

            const response = await aiResponse(conversation);
            conversation.push({ role: "assistant", content: response });

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
