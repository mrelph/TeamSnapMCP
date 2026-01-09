import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE || "teamsnap-mcp-tokens";

const TEAMSNAP_API_BASE = "https://api.teamsnap.com/v3";
const TEAMSNAP_AUTH_URL = "https://auth.teamsnap.com/oauth/authorize";
const TEAMSNAP_TOKEN_URL = "https://auth.teamsnap.com/oauth/token";
const CLIENT_ID = process.env.TEAMSNAP_CLIENT_ID;
const CLIENT_SECRET = process.env.TEAMSNAP_CLIENT_SECRET;

// Simple user ID - in production, use proper auth
const DEFAULT_USER_ID = "default";

// ============ Token Storage ============

async function saveTokens(userId, tokens) {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      teamsnapUserId: tokens.teamsnapUserId,
      teamsnapEmail: tokens.teamsnapEmail,
      updatedAt: Date.now(),
    },
  }));
}

async function getTokens(userId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { userId },
  }));
  return result.Item || null;
}

async function deleteTokens(userId) {
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { userId },
  }));
}

// ============ TeamSnap API ============

async function refreshAccessToken(tokens) {
  const response = await fetch(TEAMSNAP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
  };
}

async function teamsnapRequest(endpoint, tokens) {
  // Check if token needs refresh
  if (tokens.expiresAt && Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
    const newTokens = await refreshAccessToken(tokens);
    if (newTokens) {
      tokens = { ...tokens, ...newTokens };
      await saveTokens(DEFAULT_USER_ID, tokens);
    }
  }

  const url = endpoint.startsWith("http") ? endpoint : `${TEAMSNAP_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`TeamSnap API error: ${response.status}`);
  }

  return response.json();
}

function parseCollectionItems(data) {
  if (!data.collection?.items) return [];
  return data.collection.items.map(item => {
    const obj = {};
    for (const { name, value } of item.data) {
      obj[name] = value;
    }
    return obj;
  });
}

// ============ MCP Tool Handlers ============

const tools = [
  {
    name: "teamsnap_auth_status",
    description: "Check TeamSnap authentication status",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_logout",
    description: "Disconnect from TeamSnap",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_list_teams",
    description: "List all your TeamSnap teams",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "teamsnap_get_team",
    description: "Get details for a specific team",
    inputSchema: {
      type: "object",
      properties: { team_id: { type: "string", description: "Team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_roster",
    description: "Get players and coaches for a team",
    inputSchema: {
      type: "object",
      properties: { team_id: { type: "string", description: "Team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_events",
    description: "Get events for a team",
    inputSchema: {
      type: "object",
      properties: { team_id: { type: "string", description: "Team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_availability",
    description: "Get availability for an event",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string", description: "Event ID" } },
      required: ["event_id"],
    },
  },
];

async function handleToolCall(name, args) {
  const tokens = await getTokens(DEFAULT_USER_ID);

  if (name === "teamsnap_auth_status") {
    if (!tokens) {
      return { authenticated: false, message: "Not connected. Visit /auth to connect." };
    }
    return {
      authenticated: true,
      user: { id: tokens.teamsnapUserId, email: tokens.teamsnapEmail },
    };
  }

  if (name === "teamsnap_logout") {
    await deleteTokens(DEFAULT_USER_ID);
    return { status: "logged_out", message: "Disconnected from TeamSnap" };
  }

  // All other tools require authentication
  if (!tokens) {
    return { error: "Not authenticated. Visit /auth to connect to TeamSnap." };
  }

  try {
    switch (name) {
      case "teamsnap_list_teams": {
        const userId = tokens.teamsnapUserId;
        const data = await teamsnapRequest(`/teams/search?user_id=${userId}`, tokens);
        const teams = parseCollectionItems(data).map(t => ({
          id: t.id,
          name: t.name,
          sport: t.sport_id,
          division: t.division_name,
          season: t.season_name,
        }));
        return { count: teams.length, teams };
      }

      case "teamsnap_get_team": {
        const data = await teamsnapRequest(`/teams/search?id=${args.team_id}`, tokens);
        const teams = parseCollectionItems(data);
        return teams[0] || { error: "Team not found" };
      }

      case "teamsnap_get_roster": {
        const data = await teamsnapRequest(`/members/search?team_id=${args.team_id}`, tokens);
        const members = parseCollectionItems(data);
        const players = members.filter(m => !m.is_non_player).map(m => ({
          id: m.id, firstName: m.first_name, lastName: m.last_name,
          jerseyNumber: m.jersey_number, position: m.position,
        }));
        const coaches = members.filter(m => m.is_non_player).map(m => ({
          id: m.id, firstName: m.first_name, lastName: m.last_name,
        }));
        return { playerCount: players.length, coachCount: coaches.length, players, coaches };
      }

      case "teamsnap_get_events": {
        const data = await teamsnapRequest(`/events/search?team_id=${args.team_id}`, tokens);
        const events = parseCollectionItems(data).map(e => ({
          id: e.id, name: e.name, type: e.is_game ? "game" : "practice",
          startDate: e.start_date, location: e.location_name, opponent: e.opponent_name,
        }));
        return { count: events.length, events };
      }

      case "teamsnap_get_availability": {
        const data = await teamsnapRequest(`/availabilities/search?event_id=${args.event_id}`, tokens);
        const avail = parseCollectionItems(data);
        const grouped = { yes: [], no: [], maybe: [], noResponse: [] };
        for (const a of avail) {
          const status = String(a.status_code || "").toLowerCase();
          if (status === "yes" || status === "1") grouped.yes.push(a.member_id);
          else if (status === "no" || status === "0") grouped.no.push(a.member_id);
          else if (status === "maybe" || status === "2") grouped.maybe.push(a.member_id);
          else grouped.noResponse.push(a.member_id);
        }
        return {
          summary: { available: grouped.yes.length, unavailable: grouped.no.length,
                     maybe: grouped.maybe.length, noResponse: grouped.noResponse.length },
          details: grouped,
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ============ Lambda Handler ============

export async function handler(event) {
  const path = event.rawPath || event.path || "/";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const baseUrl = `https://${event.requestContext?.domainName || "localhost"}`;

  // OAuth: Start auth flow
  if (path === "/auth" && method === "GET") {
    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = `${baseUrl}/callback`;
    const authUrl = `${TEAMSNAP_AUTH_URL}?` + new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read",
      state,
    });

    return {
      statusCode: 302,
      headers: { Location: authUrl },
    };
  }

  // OAuth: Handle callback
  if (path === "/callback" && method === "GET") {
    const params = event.queryStringParameters || {};
    const code = params.code;
    const error = params.error;

    if (error) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/html" },
        body: `<h1>Error</h1><p>${error}</p>`,
      };
    }

    if (!code) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/html" },
        body: "<h1>Error</h1><p>No authorization code</p>",
      };
    }

    // Exchange code for token
    const redirectUri = `${baseUrl}/callback`;
    const tokenResponse = await fetch(TEAMSNAP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/html" },
        body: `<h1>Token Error</h1><p>${text}</p>`,
      };
    }

    const tokenData = await tokenResponse.json();
    const tokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null,
    };

    // Get user info
    try {
      const meResponse = await fetch(`${TEAMSNAP_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
      });
      const meData = await meResponse.json();
      const users = parseCollectionItems(meData);
      if (users[0]) {
        tokens.teamsnapUserId = String(users[0].id);
        tokens.teamsnapEmail = users[0].email;
      }
    } catch (e) { /* ignore */ }

    await saveTokens(DEFAULT_USER_ID, tokens);

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `
        <html>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1 style="color: #22c55e;">✓ Connected to TeamSnap!</h1>
            <p>You can close this window and return to Claude.</p>
          </body>
        </html>
      `,
    };
  }

  // MCP: List tools
  if (path === "/mcp/tools" && method === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tools }),
    };
  }

  // MCP: Call tool
  if (path === "/mcp/call" && method === "POST") {
    const body = JSON.parse(event.body || "{}");
    const { name, arguments: args } = body;
    const result = await handleToolCall(name, args || {});
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }),
    };
  }

  // JSON-RPC MCP endpoint (for wrapper)
  if (method === "POST" && (path === "/" || path === "/mcp")) {
    try {
      const body = JSON.parse(event.body || "{}");
      const { jsonrpc, id, method: rpcMethod, params } = body;

      if (rpcMethod === "tools/list") {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }),
        };
      }

      if (rpcMethod === "tools/call") {
        const { name, arguments: args } = params || {};
        const result = await handleToolCall(name, args || {});
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
          }),
        };
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }),
      };
    } catch (err) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
      };
    }
  }

  // Health check / info
  if (path === "/" && method === "GET") {
    const tokens = await getTokens(DEFAULT_USER_ID);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "TeamSnap MCP Server",
        authenticated: !!tokens,
        authUrl: `${baseUrl}/auth`,
        endpoints: {
          auth: "/auth",
          callback: "/callback",
          tools: "/mcp/tools",
          call: "/mcp/call",
          jsonrpc: "/ (POST)",
        },
      }),
    };
  }

  return {
    statusCode: 404,
    body: JSON.stringify({ error: "Not found" }),
  };
}
