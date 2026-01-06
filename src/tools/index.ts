import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "teamsnap_auth",
    description:
      "Authenticate with TeamSnap. Opens a browser window for OAuth login. Credentials are loaded from environment variables (TEAMSNAP_CLIENT_ID, TEAMSNAP_CLIENT_SECRET) or can be passed as arguments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_id: {
          type: "string",
          description: "Your TeamSnap OAuth client ID (optional if set in environment)",
        },
        client_secret: {
          type: "string",
          description: "Your TeamSnap OAuth client secret (optional if set in environment)",
        },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_auth_status",
    description:
      "Check the current TeamSnap authentication status. Returns whether you are connected and user info if authenticated.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "teamsnap_logout",
    description: "Disconnect from TeamSnap and clear stored credentials.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "teamsnap_list_teams",
    description:
      "List all TeamSnap teams you have access to. Returns team names, IDs, sport, division, and season info.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "teamsnap_get_team",
    description: "Get detailed information about a specific team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: {
          type: "string",
          description: "The TeamSnap team ID",
        },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_roster",
    description:
      "Get the roster (players and coaches) for a team. Returns member names, jersey numbers, positions, and roles.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: {
          type: "string",
          description: "The TeamSnap team ID",
        },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_events",
    description:
      "Get events (games, practices, etc.) for a team. Optionally filter by date range.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: {
          type: "string",
          description: "The TeamSnap team ID",
        },
        start_date: {
          type: "string",
          description: "Filter events starting from this date (ISO 8601 format, e.g., 2024-01-01)",
        },
        end_date: {
          type: "string",
          description: "Filter events until this date (ISO 8601 format)",
        },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_event",
    description: "Get detailed information about a specific event.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The TeamSnap event ID",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_get_availability",
    description:
      "Get availability responses for an event. Shows who is available, unavailable, or hasn't responded.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The TeamSnap event ID",
        },
      },
      required: ["event_id"],
    },
  },
];
