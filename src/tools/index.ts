import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "teamsnap_auth",
    description:
      "Authenticate with TeamSnap. Opens a browser window for OAuth login. Credentials are loaded from environment variables (TEAMSNAP_CLIENT_ID, TEAMSNAP_CLIENT_SECRET) or can be passed as arguments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_id: { type: "string", description: "Your TeamSnap OAuth client ID (optional if set in environment)" },
        client_secret: { type: "string", description: "Your TeamSnap OAuth client secret (optional if set in environment)" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_auth_status",
    description: "Check the current TeamSnap authentication status.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "teamsnap_logout",
    description: "Disconnect from TeamSnap and clear stored credentials.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "teamsnap_list_teams",
    description: "List all TeamSnap teams you have access to.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "teamsnap_get_team",
    description: "Get detailed information about a specific team, including sport name, timezone, and public site URL.",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_roster",
    description:
      "Get the roster for a team. Returns players and coaches with contact info (primary email/phone), birthday, gender, and photo URL.",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_events",
    description:
      "Get events (games, practices) for a team. Returns rich fields including arrival time, duration, location notes, uniform, and localized times in the event's own timezone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        start_date: { type: "string", description: "Filter events starting from this date (ISO 8601)" },
        end_date: { type: "string", description: "Filter events until this date (ISO 8601)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_event",
    description:
      "Get detailed information about a specific event, with the full field set, localized times, and the inlined location object (address, map link, parking notes).",
    inputSchema: {
      type: "object" as const,
      properties: { event_id: { type: "string", description: "The TeamSnap event ID" } },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_get_availability",
    description: "Get availability responses for an event grouped by status (yes/no/maybe/noResponse).",
    inputSchema: {
      type: "object" as const,
      properties: { event_id: { type: "string", description: "The TeamSnap event ID" } },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_get_location",
    description:
      "Get full location details (address, latitude/longitude, parking notes, phone, Google Maps link). Provide exactly one of location_id or event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        location_id: { type: "string", description: "The TeamSnap location ID" },
        event_id: { type: "string", description: "An event ID (resolves the event's location)" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_get_contacts",
    description:
      "Get contacts (parents/guardians) with their email addresses and phone numbers. Provide exactly one of member_id or team_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        member_id: { type: "string", description: "Scope to one member's contacts" },
        team_id: { type: "string", description: "Scope to all contacts on a team" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_get_announcements",
    description:
      "Get recent announcements for a team (broadcast emails, broadcast alerts, and in-app messages unified into one feed, sorted by most recent).",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        since: { type: "string", description: "Only return announcements sent after this ISO 8601 date" },
        limit: { type: "number", description: "Maximum number of announcements to return (default 20)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_assignments",
    description:
      "Get volunteer/snack/carpool assignments (tracked items + statuses + assignments joined). Provide exactly one of team_id or event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "All assignments on a team" },
        event_id: { type: "string", description: "All assignments on a specific event" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_get_opponents",
    description: "Get the opponent catalog for a team with head-to-head record (wins/losses/ties + last result).",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_results_and_standings",
    description: "Get a team's record (wins/losses/ties, points for/against) and division standings.",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_member_availability",
    description:
      "Get one member's RSVP history across all their events, with each event's name and localized start time. Useful for 'has Jonah said yes to any of the last 5 games?'",
    inputSchema: {
      type: "object" as const,
      properties: {
        member_id: { type: "string", description: "The TeamSnap member ID" },
        start_date: { type: "string", description: "Only include events on or after this date (ISO 8601)" },
        end_date: { type: "string", description: "Only include events on or before this date (ISO 8601)" },
      },
      required: ["member_id"],
    },
  },
  {
    name: "teamsnap_get_stats",
    description:
      "Get team, member, or event statistics. scope=team returns team-wide stats; scope=member requires member_id; scope=event requires event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        scope: {
          type: "string",
          enum: ["team", "member", "event"],
          description: "Which statistics scope to fetch (default: team)",
        },
        member_id: { type: "string", description: "Required when scope=member" },
        event_id: { type: "string", description: "Required when scope=event" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_forum_topics",
    description: "List forum discussion topics for a team, sorted by most recent activity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        limit: { type: "number", description: "Maximum number of topics to return (default 20)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_forum_posts",
    description: "Get forum posts for a topic, sorted oldest-first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: { type: "string", description: "The forum topic ID" },
        limit: { type: "number", description: "Maximum number of posts to return (default 50)" },
      },
      required: ["topic_id"],
    },
  },
  {
    name: "teamsnap_get_calendar_urls",
    description: "Get iCal and webcal URLs for a team's schedule (both full-schedule and games-only variants).",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_custom_data",
    description:
      "Get custom-field values defined by the team or league (e.g. waiver status, allergies, emergency contact). Provide exactly one of team_id or member_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "Team-scoped custom fields" },
        member_id: { type: "string", description: "Member-scoped custom fields" },
      },
      required: [],
    },
  },
];
