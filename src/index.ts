import 'dotenv/config';
import {
  LinearClient,
  type AgentSessionEventWebhookPayload,
  LinearWebhooks,
} from "@linear/sdk";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth.js";
import { AgentActivityType, Content } from "./lib/types.js";

interface TokenStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  list(options?: { prefix: string }): Promise<{ keys: { name: string }[] }>;
}

class MemoryTokenStorage implements TokenStorage {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async list(options?: { prefix: string }): Promise<{ keys: { name: string }[] }> {
    const keys = Array.from(this.store.keys())
      .filter(key => options?.prefix ? key.startsWith(options.prefix) : true)
      .map(name => ({ name }));
    return { keys };
  }
}

const app = new Hono();

// Initialize token storage
const tokenStorage: TokenStorage = new MemoryTokenStorage();

// Helper to convert Hono context to Env-like object for OAuth handlers
function getEnvFromContext(): any {
  return {
    LINEAR_CLIENT_ID: process.env.LINEAR_CLIENT_ID,
    LINEAR_CLIENT_SECRET: process.env.LINEAR_CLIENT_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET,
    WORKER_URL: process.env.WORKER_URL,
    LINEAR_REDIRECT_URI: `${process.env.WORKER_URL}/oauth/callback`,
    AGENT_TOKENS: tokenStorage
  };
}

app.get("/", (c) => {
  return c.text("Fuse Agent Worker is running", 200);
});

app.get("/oauth/authorize", async (c) => {
  const response = await handleOAuthAuthorize(c.req.raw, getEnvFromContext());
  return new Response(response.body, response);
});

app.get("/oauth/callback", async (c) => {
  const response = await handleOAuthCallback(c.req.raw, getEnvFromContext());
  return new Response(response.body, response);
});

import {
  isLinearIssuePayload,
  shouldProcessIssue,
  hasRequiredCapabilities
} from "./lib/webhookTypes.js";
import { AgentClient } from "./lib/agent/agentClient.js";

app.post("/webhook", async (c) => {
  const webhookEnv = getEnvFromContext();
  if (!webhookEnv.LINEAR_WEBHOOK_SECRET) {
    console.error("[DEBUG] Webhook validation failed - secret not configured");
    return c.text("Webhook secret not configured", 500);
  }

  const apiEnv = getEnvFromContext();
  if (!apiEnv.OPENAI_API_KEY) {
    console.error("OpenAI API key not configured");
    return c.text("OpenAI API key not configured", 500);
  }

  try {
    const text = await c.req.text();
    console.log("[DEBUG] Webhook payload received - length:", text.length);
    const payloadBuffer = Buffer.from(text);
    const linearSignature = c.req.header("linear-signature") || "";
    console.log("[DEBUG] Webhook validation started - signature:", linearSignature ? "present" : "missing");

    const linearWebhooks = new LinearWebhooks(webhookEnv.LINEAR_WEBHOOK_SECRET);
    const parsedPayload = linearWebhooks.parseData(payloadBuffer, linearSignature);
    console.log("[DEBUG] Webhook validation completed - type:", parsedPayload.type);

    // Handle Issue webhooks
    if (isLinearIssuePayload(parsedPayload)) {
      const issue = parsedPayload.data;
      console.log("[DEBUG] Processing Issue webhook - ID:", issue.id, "Title:", issue.title);
      if (!shouldProcessIssue(issue)) {
        console.log("[DEBUG] Task filtered out - criteria:", JSON.stringify({
          hasDescription: !!issue.description,
          hasLabels: issue.labels ? true : false
        }));
        return c.text("Task filtered out", 200);
      }

      // Check if agent has required capabilities
      const linearToken = await tokenStorage.get("linear_access_token");
      console.log("[DEBUG] Token validation - Linear:", linearToken ? "exists" : "missing",
        "OpenAI:", process.env.OPENAI_API_KEY ? "exists" : "missing");
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!linearToken || !openaiKey) {
        console.error("[DEBUG] Configuration check failed - missing:",
          !linearToken ? "Linear token" : "",
          !openaiKey ? "OpenAI key" : "");
        return c.text("Agent not properly configured", 500);
      }

      // Initialize dependencies
      const stateStorage = new SQLiteStateStorage('state.db');
      const activityStorage = new InMemoryActivityStorage();
      const openai = new OpenAI({ apiKey: openaiKey });
      
      const agentClient = new AgentClient(stateStorage, activityStorage, openai);
      
      // Temporarily disable capabilities check
      console.log("[DEBUG] Skipping capabilities check during implementation");

      // Process the task here
      console.log("Processing task for issue:", issue.id);
      return c.text("Task processed", 200);
    }

    // Handle AgentSessionEvent webhooks
    if (parsedPayload.type === "AgentSessionEvent") {
      const webhook = parsedPayload as AgentSessionEventWebhookPayload;
      console.log("[DEBUG] Processing AgentSessionEvent - org:", webhook.organizationId,
        "session:", webhook.agentSession.id);
      const token = await getOAuthToken(getEnvFromContext(), webhook.organizationId);
      console.log("[DEBUG] Org verification - token:", token ? "exists" : "missing",
        "org:", webhook.organizationId);
      if (!token) {
        console.error("Linear OAuth token not found for org:", webhook.organizationId);
        return c.text("Linear OAuth token not found", 500);
      }
      try {
        await handleWebhook(webhook, token, apiEnv.OPENAI_API_KEY);
      } catch (err) {
        console.error("Error handling webhook:", err);
      }
    }

    console.log("Webhook processed successfully");
    return c.text("Webhook handled", 200);
  } catch (error) {
    console.error("Error handling webhook:", error);
    return c.text("Error handling webhook", 500);
  }
});

import { SQLiteStateStorage } from './lib/storage/sqliteStateStorage.js';
import { InMemoryActivityStorage } from './lib/storage/inMemoryActivityStorage.js';
import { OpenAI } from 'openai';

async function handleWebhook(
  webhook: AgentSessionEventWebhookPayload,
  linearAccessToken: string,
  openaiApiKey: string
): Promise<void> {
  // Initialize dependencies
  const stateStorage = new SQLiteStateStorage('state.db');
  const activityStorage = new InMemoryActivityStorage();
  const openai = new OpenAI({ apiKey: openaiApiKey });
  const linearClient = new LinearClient({ accessToken: linearAccessToken });
  
  const agentClient = new AgentClient(stateStorage, activityStorage, openai);
    
  const userPrompt = generateUserPrompt(webhook);
  console.log("[DEBUG] User prompt generated:", userPrompt.substring(0, 50) + (userPrompt.length > 50 ? "..." : ""));

  const content = await agentClient.handleUserPrompt(webhook.agentSession.id, userPrompt);
  
  // Handle all response types appropriately
  if (webhook.agentSession.issue?.id) {
    switch (content.type) {
      case AgentActivityType.Response:
        console.log(`[DEBUG] Posting response to Linear: ${content.body}`);
        await linearClient.createComment({
          issueId: webhook.agentSession.issue.id,
          body: content.body
        });
        break;
      case AgentActivityType.Error:
        console.error(`[ERROR] Posting error to Linear: ${content.body}`);
        await linearClient.createComment({
          issueId: webhook.agentSession.issue.id,
          body: `Agent error: ${content.body}`
        });
        break;
      case AgentActivityType.Elicitation:
        console.log(`[DEBUG] Posting elicitation to Linear: ${content.body}`);
        await linearClient.createComment({
          issueId: webhook.agentSession.issue.id,
          body: `Agent requires more context: ${content.parameter}: ${content.body}`
        });
        break;
      case AgentActivityType.Action:
        console.log(`[DEBUG] Posting action to Linear: ${content.action}(${content.parameter})`);
        await linearClient.createComment({
          issueId: webhook.agentSession.issue.id,
          body: `Agent action: ${content.action}(${content.parameter})`
        });
        break;
      default:
        console.log(`[DEBUG] Agent activity: ${content.type}${'body' in content ? ` - ${content.body}` : ''}`);
    }
  } else {
    console.log('[WARN] No issue ID found for session, skipping Linear comment');
  }
}

function generateUserPrompt(webhook: AgentSessionEventWebhookPayload): string {
  const issueTitle = webhook.agentSession.issue?.title;
  const commentBody = webhook.agentSession.comment?.body;
  console.log("[DEBUG] Comment processing - issue:", issueTitle ? issueTitle.substring(0, 50) + (issueTitle.length > 50 ? "..." : "") : "none",
    "comment:", commentBody ? commentBody.substring(0, 50) + (commentBody.length > 50 ? "..." : "") : "none");
  if (issueTitle && commentBody) {
    return `Issue: ${issueTitle}\n\n Task: ${commentBody}`;
  } else if (issueTitle) {
    return `Task: ${issueTitle}`;
  } else if (commentBody) {
    return `Task: ${commentBody}`;
  }
  return "";
}

// Start the server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const hostname = process.env.HOST || "0.0.0.0";

console.log(`Server running on http://${hostname}:${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname,
});

export default app;
