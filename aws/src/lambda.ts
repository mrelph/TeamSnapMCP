import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomBytes } from "crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "../../src/tools/index.js";
import { handleToolCall } from "../../src/tools/handlers/index.js";
import { TeamSnapClient as AwsTeamSnapClient } from "./client.js";
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  savePendingAuth,
  getPendingAuth,
  deletePendingAuth,
} from "./dynamodb.js";
import { _setTeamSnapClient } from "../../src/api/client.js";

const awsClient = new AwsTeamSnapClient();
let awsClientReady: Promise<void> | null = null;
function ensureAwsClient(): Promise<void> {
  if (!awsClientReady) {
    awsClientReady = awsClient.loadCredentials();
  }
  return awsClientReady;
}

// Override the shared singleton with AWS-backed client. Cast is safe:
// both classes expose the same public method set (verified by parity test).
_setTeamSnapClient(awsClient as unknown as import("../../src/api/client.js").TeamSnapClient);

const TEAMSNAP_AUTH_URL = "https://auth.teamsnap.com/oauth/authorize";
const TEAMSNAP_TOKEN_URL = "https://auth.teamsnap.com/oauth/token";
const TEAMSNAP_SCOPES = "read";

function getBaseUrl(event: APIGatewayProxyEventV2): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const host = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  return stage === "$default" ? `https://${host}` : `https://${host}/${stage}`;
}

async function handleTool(name: string, args: Record<string, unknown>, baseUrl: string): Promise<CallToolResult> {
  if (name === "teamsnap_auth") {
    const clientId = process.env.TEAMSNAP_CLIENT_ID;
    const clientSecret = process.env.TEAMSNAP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return { content: [{ type: "text", text: "TEAMSNAP_CLIENT_ID and TEAMSNAP_CLIENT_SECRET must be set" }], isError: true };
    }
    const state = randomBytes(16).toString("hex");
    await savePendingAuth(state, clientId, clientSecret);
    const redirectUri = `${baseUrl}/callback`;
    const authUrl = `${TEAMSNAP_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${TEAMSNAP_SCOPES}&state=${state}`;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "pending",
          message: "Open this URL in your browser to authenticate:",
          authUrl,
          note: "After authenticating, come back and check status with teamsnap_auth_status",
        }, null, 2),
      }],
    };
  }

  if (name === "teamsnap_auth_status") {
    const creds = await loadCredentials();
    if (!creds) {
      return { content: [{ type: "text", text: JSON.stringify({ authenticated: false, message: "Not connected. Use teamsnap_auth to connect." }, null, 2) }] };
    }
    const client = new AwsTeamSnapClient();
    await client.loadCredentials();
    try {
      const user = await client.getMe();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authenticated: true,
            user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
          }, null, 2),
        }],
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authenticated: true,
            user: { id: creds.teamsnapUserId, email: creds.teamsnapEmail },
            note: "Could not fetch fresh user info",
          }, null, 2),
        }],
      };
    }
  }

  if (name === "teamsnap_logout") {
    await clearCredentials();
    return { content: [{ type: "text", text: JSON.stringify({ status: "logged_out", message: "Successfully disconnected from TeamSnap." }, null, 2) }] };
  }

  // All other tools delegate to shared handler router. AWS client swaps in via global init below.
  return handleToolCall(name, args);
}

// OAuth callback handler
async function handleCallback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // Debug logging
  console.log("Callback received:", JSON.stringify({
    path: event.rawPath,
    query: event.queryStringParameters,
    rawQuery: event.rawQueryString,
    headers: event.headers,
  }));

  const params = event.queryStringParameters || {};
  const { code, state, error: oauthError } = params;

  if (oauthError) {
    return { statusCode: 400, body: `<html><body><h1>Authentication Failed</h1><p>${oauthError}</p></body></html>`, headers: { "Content-Type": "text/html" } };
  }

  if (!code) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/html" },
      body: `<html><body>
        <h1>Missing Parameters</h1>
        <p>Expected 'code' query parameter.</p>
        <p><strong>Received query string:</strong> ${event.rawQueryString || "(empty)"}</p>
        <p>Make sure your TeamSnap redirect URI matches your API Gateway callback URL.</p>
      </body></html>`
    };
  }

  // Try to get pending auth from state, or fall back to environment credentials
  let clientId = process.env.TEAMSNAP_CLIENT_ID;
  let clientSecret = process.env.TEAMSNAP_CLIENT_SECRET;

  if (state) {
    const pending = await getPendingAuth(state);
    if (pending) {
      clientId = pending.clientId;
      clientSecret = pending.clientSecret;
      await deletePendingAuth(state);
    }
  }

  if (!clientId || !clientSecret) {
    return { statusCode: 400, body: "Missing OAuth credentials. Please try authenticating again." };
  }

  const baseUrl = getBaseUrl(event);
  const redirectUri = `${baseUrl}/callback`;

  try {
    const tokenResponse = await fetch(TEAMSNAP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return { statusCode: 400, body: `Token exchange failed: ${text}` };
    }

    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number };

    await saveCredentials({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      clientId,
      clientSecret,
    });

    // Try to get user info
    try {
      const client = new AwsTeamSnapClient();
      await client.loadCredentials();
      const user = await client.getMe();
      const creds = await loadCredentials();
      if (creds) {
        await saveCredentials({
          ...creds,
          teamsnapUserId: String(user.id),
          teamsnapEmail: String(user.email || ""),
        });
      }
    } catch {
      // User info is optional
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `
        <html>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1 style="color: #22c55e;">Successfully Connected!</h1>
            <p>TeamSnap MCP is now authenticated.</p>
            <p>You can close this window and return to Claude.</p>
          </body>
        </html>
      `,
    };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

// MCP JSON-RPC handler (supports Streamable HTTP transport)
async function handleMCP(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const httpMethod = event.requestContext.http.method;

  await ensureAwsClient();

  // DELETE = session cleanup
  if (httpMethod === "DELETE") {
    return { statusCode: 200, body: "" };
  }

  // GET = SSE stream (not supported in Lambda, return 405)
  if (httpMethod === "GET") {
    return { statusCode: 405, body: "SSE not supported" };
  }

  const body = JSON.parse(event.body || "{}");
  const { method, params, id } = body;
  const baseUrl = getBaseUrl(event);

  const mcpHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Notifications have no id — acknowledge with 204
  if (id === undefined || id === null) {
    return { statusCode: 204, headers: mcpHeaders, body: "" };
  }

  let result: unknown;

  switch (method) {
    case "initialize":
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "teamsnap-mcp", version: "0.1.0" },
      };
      break;

    case "tools/list":
      result = { tools };
      break;

    case "tools/call":
      result = await handleTool(params.name, params.arguments || {}, baseUrl);
      break;

    default:
      return {
        statusCode: 200,
        headers: mcpHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }),
      };
  }

  return {
    statusCode: 200,
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id, result }),
  };
}

// Main handler
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath || event.requestContext.http.path;

  // Health check
  if (path === "/" || path === "/health") {
    return { statusCode: 200, body: JSON.stringify({ status: "ok", service: "teamsnap-mcp" }) };
  }

  // OAuth callback
  if (path === "/callback") {
    return handleCallback(event);
  }

  // MCP endpoint (POST = JSON-RPC, DELETE = session cleanup)
  if (path === "/mcp" && (event.requestContext.http.method === "POST" || event.requestContext.http.method === "DELETE")) {
    return handleMCP(event);
  }

  return { statusCode: 404, body: "Not found" };
}
