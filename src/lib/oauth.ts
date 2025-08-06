import { debug } from "console";
import { OAuthTokenResponse } from "./types.js";
import { getStorage } from "./storage/index.js";

interface Env {
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  WORKER_URL: string;
}

interface StoredToken {
  access_token: string;
  expires_at: number;
  refresh_token?: string;
}

const AGENT_TOKEN_KEY_PREFIX = "agent_token_";

function getWorkspaceTokenKey(workspaceId: string): string {
  return `${AGENT_TOKEN_KEY_PREFIX}${workspaceId}`;
}

function logTokenOperation(operation: string, workspaceId?: string, metadata?: Record<string, unknown>) {
  console.debug(`[OAuth] ${operation}`, {
    workspaceId,
    ...metadata
  });
}

function isStoredToken(token: unknown): token is StoredToken {
  if (typeof token !== 'object' || token === null) return false;
  const t = token as Record<string, unknown>;
  return typeof t.access_token === 'string' &&
         typeof t.expires_at === 'number' &&
         (t.refresh_token === undefined || typeof t.refresh_token === 'string');
}

export function handleOAuthAuthorize(request: Request, env: Env): Response {
  const scope = "read,write,app:assignable,app:mentionable";
  const authUrl = new URL("https://linear.app/oauth/authorize");
  authUrl.searchParams.set("client_id", env.LINEAR_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${env.WORKER_URL}/oauth/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("actor", "app");
  return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
}

export async function handleOAuthCallback(request: Request, env: Env, workspaceId?: string): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return new Response(`OAuth Error: ${error}`, { status: 400 });
  if (!code) return new Response("Missing required OAuth parameters", { status: 400 });

  try {
    logTokenOperation(`Exchanging authorization code for token`, workspaceId, {
      client_id: env.LINEAR_CLIENT_ID,
      redirect_uri: `${env.WORKER_URL}/oauth/callback`,
      has_workspace_id: !!workspaceId
    });

    const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET,
        code,
        redirect_uri: `${env.WORKER_URL}/oauth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return new Response(`Token exchange failed: ${errorText}`, { status: 400 });
    }

    const tokenData = (await tokenResponse.json()) as OAuthTokenResponse;
    if (!tokenData.access_token || !tokenData.token_type || !tokenData.expires_in) {
      throw new Error(`Invalid token response from Linear - missing required fields`);
    }

    const workspaceInfo = await getWorkspaceInfo(tokenData.access_token);
    if (!workspaceInfo) throw new Error('Failed to get workspace info from Linear API');

    const storedToken: StoredToken = {
      access_token: tokenData.access_token,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      refresh_token: tokenData.refresh_token
    };

    await setOAuthToken(env, JSON.stringify(storedToken), workspaceInfo.id);

    return new Response(`
      <html>
        <head><title>OAuth Success</title></head>
        <body>
          <h1>OAuth Authorization Successful!</h1>
          <p>Access token received for workspace: <strong>${workspaceInfo.name}</strong></p>
        </body>
      </html>`, { status: 200, headers: { "Content-Type": "text/html" } });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return new Response(`Token exchange error: ${errorMessage}`, { status: 500 });
  }
}

export async function getOAuthToken(env: Env, workspaceId: string): Promise<string | null> {
  if (!workspaceId) throw new Error('Workspace ID is required');
  const key = getWorkspaceTokenKey(workspaceId);
  
  try {
    const storage = getStorage();
    const tokenStr = await storage.get(key);
    if (!tokenStr) {
      logTokenOperation("Token not found in storage", workspaceId, { key });
      return null;
    }

    const tokenData = JSON.parse(tokenStr);
    if (!isStoredToken(tokenData)) {
      console.error('Invalid token format in storage');
      return null;
    }

    if (tokenData.expires_at < Date.now()) {
      if (!tokenData.refresh_token) {
        logTokenOperation("Token expired but no refresh token available", workspaceId);
        return null;
      }
      
      logTokenOperation("Refreshing expired token", workspaceId);
      const newToken = await refreshToken(env, tokenData.refresh_token);
      await setOAuthToken(env, JSON.stringify(newToken), workspaceId);
      return newToken.access_token;
    }
    return tokenData.access_token;
  } catch (e) {
    console.error('Failed to parse token data:', e);
    return null;
  }
}

async function refreshToken(env: Env, refreshToken: string): Promise<StoredToken> {
  if (!refreshToken) throw new Error("Cannot refresh token - no refresh token provided");
  
  logTokenOperation("Starting token refresh");
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.LINEAR_CLIENT_ID,
      client_secret: env.LINEAR_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) throw new Error(`Token refresh failed: ${response.statusText}`);

  const tokenData = (await response.json()) as OAuthTokenResponse;
  logTokenOperation("Token refresh successful", undefined, { expires_in: tokenData.expires_in });
  
  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || refreshToken,
    expires_at: Date.now() + (tokenData.expires_in * 1000)
  };
}

async function setOAuthToken(env: Env, token: string, workspaceId: string): Promise<void> {
  const key = getWorkspaceTokenKey(workspaceId);
  try {
    const storage = getStorage();
    await storage.put(key, token);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error('Failed to store OAuth token:', error.message);
    throw new Error(`Token storage failed: ${error.message}`);
  }
}

async function getWorkspaceInfo(accessToken: string): Promise<{id: string, name: string}> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: `query { viewer { organization { id name } } }`
    }),
  });

  if (!response.ok) throw new Error(`Failed to get workspace info: ${response.statusText}`);

  const data = await response.json() as { data?: { viewer?: { organization?: { id: string, name: string } } } };
  const organization = data.data?.viewer?.organization;
  if (!organization) throw new Error("No organization found in response");

  return organization;
}
