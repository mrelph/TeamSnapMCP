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
  {
    name: "teamsnap_whoami_members",
    description:
      "Resolve the authenticated TeamSnap user to their member record on each of their teams, reporting permission flags (is_manager, is_owner, is_commissioner) per team. Answers \"which teams am I actually a manager on?\" without opening the app. Read-only.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "teamsnap_set_availability",
    description:
      "Set a member's RSVP for an event. Patches the existing availability record. Preview by default; pass preview: false to commit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Event to RSVP to" },
        member_id: { type: "string", description: "Member whose RSVP is being set" },
        status: { type: "string", enum: ["yes", "no", "maybe"], description: "RSVP status" },
        notes: { type: "string", description: "Optional note attached to the RSVP" },
        preview: { type: "boolean", description: "If true (default), return the payload without patching" },
      },
      required: ["event_id", "member_id", "status"],
    },
  },
  {
    name: "teamsnap_update_tracked_item_status",
    description:
      "Update a tracked-item status (snack sign-up, carpool, etc.) to pending, claimed, or complete. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tracked_item_status_id: { type: "string", description: "Tracked item status record id" },
        status: { type: "string", enum: ["pending", "claimed", "complete"] },
        notes: { type: "string", description: "Optional note" },
        preview: { type: "boolean", description: "If true (default), return the payload without patching" },
      },
      required: ["tracked_item_status_id", "status"],
    },
  },
  {
    name: "teamsnap_create_tracked_item",
    description:
      "Create a new tracked item (snack sign-up, carpool, etc.) for a team or event. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        name: { type: "string", description: "Short label, e.g. 'Snacks'" },
        event_id: { type: "string", description: "Optional: attach to a single event" },
        due_date: { type: "string", description: "Optional ISO 8601" },
        description: { type: "string" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["team_id", "name"],
    },
  },
  {
    name: "teamsnap_assign_tracked_item",
    description: "Assign a tracked item to a team member. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tracked_item_id: { type: "string" },
        member_id: { type: "string" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["tracked_item_id", "member_id"],
    },
  },
  {
    name: "teamsnap_create_event",
    description:
      "Create a new event (game, practice, meeting). Returns the created event with localized times. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        name: { type: "string" },
        is_game: { type: "boolean", description: "Game vs practice/other" },
        start_date: { type: "string", description: "ISO 8601 UTC start time" },
        duration_in_minutes: { type: "number" },
        location_id: { type: "string" },
        opponent_id: { type: "string", description: "For games" },
        notes: { type: "string" },
        uniform: { type: "string" },
        arrival_minutes_early: { type: "number" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["team_id", "name", "start_date"],
    },
  },
  {
    name: "teamsnap_update_event",
    description:
      "Update an existing event via a patch object. Non-destructive fields (name, start_date, location_id, duration_in_minutes, notes, uniform, opponent_id, minutes_to_arrive_early) update freely. Setting is_canceled: true requires confirm: true because it notifies the team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string" },
        patch: {
          type: "object",
          description:
            "Object of fields to update. Supported keys: name, start_date, location_id, duration_in_minutes, notes, uniform, opponent_id, minutes_to_arrive_early, is_canceled.",
        },
        preview: { type: "boolean", description: "If true (default), return the payload without patching" },
        confirm: { type: "boolean", description: "Required when patch.is_canceled is true" },
      },
      required: ["event_id", "patch"],
    },
  },
  {
    name: "teamsnap_delete_event",
    description:
      "Permanently delete an event. Preview by default; requires confirm: true to execute. This cannot be undone through this server — prefer teamsnap_update_event with is_canceled: true if you only want to call the event off.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The TeamSnap event ID" },
        preview: { type: "boolean", description: "If true (default), report what would be deleted without deleting" },
        confirm: { type: "boolean", description: "Required to actually delete" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_send_team_message",
    description:
      "Post an in-app message to the team's message board. No emails or push notifications are sent. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        body: { type: "string", description: "Message body" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["team_id", "body"],
    },
  },
  {
    name: "teamsnap_send_announcement",
    description:
      "Send a broadcast email or push alert to the team (or a subset of members). Real emails/alerts are sent. Preview by default; always requires confirm: true to actually send.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        channel: { type: "string", enum: ["email", "alert"], description: "Delivery channel" },
        subject: { type: "string" },
        body: { type: "string" },
        recipient_member_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional: specific members (default: whole team)",
        },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without sending" },
        confirm: { type: "boolean", description: "Required to actually send" },
      },
      required: ["team_id", "channel", "subject", "body"],
    },
  },
];
