import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomBytes } from "crypto";
import { TeamSnapClient } from "./teamsnap.js";
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  savePendingAuth,
  getPendingAuth,
  deletePendingAuth,
} from "./dynamodb.js";

const TEAMSNAP_AUTH_URL = "https://auth.teamsnap.com/oauth/authorize";
const TEAMSNAP_TOKEN_URL = "https://auth.teamsnap.com/oauth/token";
const TEAMSNAP_SCOPES = "read";

// Get the base URL from environment or construct from the event
function getBaseUrl(event: APIGatewayProxyEventV2): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const host = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  return stage === "$default" ? `https://${host}` : `https://${host}/${stage}`;
}

// MCP Tool definitions
const tools = [
  {
    name: "teamsnap_auth",
    description: "Authenticate with TeamSnap. Returns a URL to open in your browser for OAuth login.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_auth_status",
    description: "Check the current TeamSnap authentication status.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_logout",
    description: "Disconnect from TeamSnap and clear stored credentials.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_list_teams",
    description: "List all TeamSnap teams you have access to.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_get_team",
    description: "Get detailed information about a specific team.",
    inputSchema: {
      type: "object",
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_roster",
    description: "Get the roster (players and coaches) for a team.",
    inputSchema: {
      type: "object",
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_events",
    description: "Get events for a team.",
    inputSchema: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        start_date: { type: "string", description: "Filter from date (ISO 8601)" },
        end_date: { type: "string", description: "Filter until date (ISO 8601)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_event",
    description: "Get detailed information about a specific event.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string", description: "The TeamSnap event ID" } },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_get_availability",
    description: "Get availability responses for an event.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string", description: "The TeamSnap event ID" } },
      required: ["event_id"],
    },
  },
];

// Tool handlers
async function handleTool(name: string, args: Record<string, unknown>, baseUrl: string): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const client = new TeamSnapClient();
  await client.loadCredentials();

  const success = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
  const error = (msg: string) => ({ content: [{ type: "text", text: msg }], isError: true });

  switch (name) {
    case "teamsnap_auth": {
      const clientId = process.env.TEAMSNAP_CLIENT_ID;
      const clientSecret = process.env.TEAMSNAP_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return error("TEAMSNAP_CLIENT_ID and TEAMSNAP_CLIENT_SECRET must be set");
      }
      const state = randomBytes(16).toString("hex");
      await savePendingAuth(state, clientId, clientSecret);
      const redirectUri = `${baseUrl}/callback`;
      const authUrl = `${TEAMSNAP_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${TEAMSNAP_SCOPES}&state=${state}`;
      return success({
        status: "pending",
        message: "Open this URL in your browser to authenticate:",
        authUrl,
        note: "After authenticating, come back and check status with teamsnap_auth_status",
      });
    }

    case "teamsnap_auth_status": {
      const creds = await loadCredentials();
      if (!creds) {
        return success({ authenticated: false, message: "Not connected. Use teamsnap_auth to connect." });
      }
      try {
        const user = await client.getMe();
        return success({
          authenticated: true,
          user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
        });
      } catch {
        return success({
          authenticated: true,
          user: { id: creds.teamsnapUserId, email: creds.teamsnapEmail },
          note: "Could not fetch fresh user info",
        });
      }
    }

    case "teamsnap_logout": {
      await clearCredentials();
      return success({ status: "logged_out", message: "Successfully disconnected from TeamSnap." });
    }

    case "teamsnap_list_teams": {
      if (!client.isAuthenticated()) return error("Not authenticated. Use teamsnap_auth first.");
      const teams = await client.getTeams();
      return success({
        count: teams.length,
        teams: teams.map((t) => ({
          id: t.id, name: t.name, sport: t.sport_id, division: t.division_name,
          season: t.season_name, league: t.league_name, isArchived: t.is_archived_season,
        })),
      });
    }

    case "teamsnap_get_team": {
      if (!client.isAuthenticated()) return error("Not authenticated.");
      const team = await client.getTeam(args.team_id as string);
      return success(team);
    }

    case "teamsnap_get_roster": {
      if (!client.isAuthenticated()) return error("Not authenticated.");
      const members = await client.getTeamMembers(args.team_id as string);
      const players = members.filter((m) => !m.is_non_player).map((m) => ({
        id: m.id, firstName: m.first_name, lastName: m.last_name,
        jerseyNumber: m.jersey_number, position: m.position,
      }));
      const coaches = members.filter((m) => m.is_non_player).map((m) => ({
        id: m.id, firstName: m.first_name, lastName: m.last_name,
        isManager: m.is_manager, isOwner: m.is_owner,
      }));
      return success({ teamId: args.team_id, playerCount: players.length, coachCount: coaches.length, players, coaches });
    }

    case "teamsnap_get_events": {
      if (!client.isAuthenticated()) return error("Not authenticated.");
      let events = await client.getTeamEvents(args.team_id as string);
      if (args.start_date) {
        const start = new Date(args.start_date as string);
        events = events.filter((e) => e.start_date && new Date(String(e.start_date)) >= start);
      }
      if (args.end_date) {
        const end = new Date(args.end_date as string);
        events = events.filter((e) => e.start_date && new Date(String(e.start_date)) <= end);
      }
      return success({
        teamId: args.team_id,
        count: events.length,
        events: events.map((e) => ({
          id: e.id, name: e.name, type: e.is_game ? "game" : "practice",
          startDate: e.start_date, location: e.location_name, opponent: e.opponent_name,
        })),
      });
    }

    case "teamsnap_get_event": {
      if (!client.isAuthenticated()) return error("Not authenticated.");
      const event = await client.getEvent(args.event_id as string);
      return success(event);
    }

    case "teamsnap_get_availability": {
      if (!client.isAuthenticated()) return error("Not authenticated.");
      const avails = await client.getAvailabilities(args.event_id as string);
      const grouped = { yes: [] as unknown[], no: [] as unknown[], maybe: [] as unknown[], noResponse: [] as unknown[] };
      for (const a of avails) {
        const status = String(a.status_code || "").toLowerCase();
        const entry = { memberId: a.member_id, notes: a.notes };
        if (status === "yes" || status === "1") grouped.yes.push(entry);
        else if (status === "no" || status === "0") grouped.no.push(entry);
        else if (status === "maybe" || status === "2") grouped.maybe.push(entry);
        else grouped.noResponse.push({ memberId: a.member_id });
      }
      return success({
        eventId: args.event_id,
        summary: { available: grouped.yes.length, unavailable: grouped.no.length, maybe: grouped.maybe.length, noResponse: grouped.noResponse.length },
        details: grouped,
      });
    }

    default:
      return error(`Unknown tool: ${name}`);
  }
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
      const client = new TeamSnapClient();
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

// MCP JSON-RPC handler
async function handleMCP(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body || "{}");
  const { method, params, id } = body;
  const baseUrl = getBaseUrl(event);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }),
      };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
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

  // MCP endpoint
  if (path === "/mcp" && event.requestContext.http.method === "POST") {
    return handleMCP(event);
  }

  return { statusCode: 404, body: "Not found" };
}
