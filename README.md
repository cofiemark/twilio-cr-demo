# Voice Assistant with Twilio and Open AI (Node.js)

This application demonstrates how to use Node.js, [Twilio Voice](https://www.twilio.com/docs/voice) and [ConversationRelay](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay), and the [Open AI API](https://docs.anthropic.com) to create a voice assistant that can engage in two-way conversations over a phone call.

Other branches in this repository demonstrate how to add more advanced features such as [streaming](https://github.com/robinske/cr-demo/tree/feature/step2-streaming-tokens), [interruption handling](https://github.com/robinske/cr-demo/tree/feature/step3-conversation-tracking), and [tool/function calling](https://github.com/robinske/cr-demo/tree/feature/step4-tool-calling).

> [!NOTE]
> Looking for a step by step tutorial? Find an [interative build guide for OpenAI and Twilio Voice here](https://github.com/robinske/forge-build-tutorial).

## Prerequisites

To use the app, you will need:

- **Node.js 23.9.0**: Download from [here](https://nodejs.org/). Other versions may work, but I tested with this one.
- **A Twilio Account**: Sign up for a free trial [here](https://www.twilio.com/try-twilio).
- **A Twilio Number with Voice Capabilities**: [Instructions to purchase a number](https://help.twilio.com/articles/223135247-How-to-Search-for-and-Buy-a-Twilio-Phone-Number-from-Console).
- **An Open AI Account and API Key**: Visit Open AI's platform [here](https://platform.openai.com/api-keys) for more information.

## Setup

### 1. Run ngrok

You'll need to expose your local server to the internet for Twilio to access it. Use ngrok for tunneling:

```bash
ngrok http 8080
```

Copy the Forwarding URL and put it aside; it looks like https://[your-ngrok-subdomain].ngrok.app. You'll need it in a couple places.

### 2. Install dependencies

Run the following command to install necessary packages:

```bash
npm install
```

### 3. Configure Twilio

Update Your Twilio Phone Number: In the Twilio Console under **Phone Numbers**, set the Webhook for **A call comes in** to your ngrok URL followed by /twiml. 

Example: `https://[your-ngrok-subdomain].ngrok.app/twiml`.

### 4. Configure Environment Variables

Copy the example environment file to `.env`:

```bash
cp .env.example .env
```

Edit the .env file and input your Open AI API key in `OPENAI_API_KEY`. Add your ngrok URL in `NGROK_URL` (do not include the scheme, "http://" or "https://")

## Run the app

Start the development server:

```bash
node server.js
```

## Deploying to Render

This codebase is pre-configured for seamless deployment to [Render](https://render.com).

### Option 1: Blueprint Deployment (Recommended)

1. Push your repository to GitHub or GitLab.
2. Log in to [Render Dashboard](https://dashboard.render.com/) and click **New +** > **Blueprint**.
3. Connect your repository. Render will automatically detect `render.yaml`.
4. Fill in your `OPENAI_API_KEY` under Environment Variables.
5. Click **Apply**.

### Option 2: Manual Web Service Setup

1. In the Render Dashboard, click **New +** > **Web Service**.
2. Connect your Git repository.
3. Configure the service settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Add the following **Environment Variables**:
   - `OPENAI_API_KEY`: Your OpenAI API key.
   - `PORT`: `8080` (or leave default, Render sets `PORT` automatically).
5. Click **Create Web Service**.

### Configure Twilio Webhook for Render

Once deployed, copy your Render Web Service URL (e.g., `https://twilio-cr-demo.onrender.com`).

1. Open the [Twilio Console](https://console.twilio.com/).
2. Navigate to **Phone Numbers** > **Active Numbers** > select your number.
3. Under **Voice & Fax** -> **A CALL COMES IN**, set:
   - **Webhook**: `https://<your-render-app>.onrender.com/twiml`
   - **HTTP Method**: `POST` (or `GET`)
4. Save the configuration and call your Twilio number to start conversing!

