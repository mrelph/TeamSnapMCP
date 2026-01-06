import open from "open";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../api/client.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { clearCredentials, hasCredentials, loadCredentials } from "../utils/storage.js";

function success(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function error(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

type ToolArgs = Record<string, unknown>;

export async function handleToolCall(name: string, args: ToolArgs): Promise<CallToolResult> {
  switch (name) {
    case "teamsnap_auth":
      return handleAuth(args);
    case "teamsnap_auth_status":
      return handleAuthStatus();
    case "teamsnap_logout":
      return handleLogout();
    case "teamsnap_list_teams":
      return handleListTeams();
    case "teamsnap_get_team":
      return handleGetTeam(args);
    case "teamsnap_get_roster":
      return handleGetRoster(args);
    case "teamsnap_get_events":
      return handleGetEvents(args);
    case "teamsnap_get_event":
      return handleGetEvent(args);
    case "teamsnap_get_availability":
      return handleGetAvailability(args);
    default:
      return error(`Unknown tool: ${name}`);
  }
}

async function handleAuth(args: ToolArgs): Promise<CallToolResult> {
  // Use args if provided, otherwise fall back to environment variables
  const clientId = (args.client_id as string) || process.env.TEAMSNAP_CLIENT_ID;
  const clientSecret = (args.client_secret as string) || process.env.TEAMSNAP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return error(
      "Missing client_id or client_secret. Either pass them as arguments or set TEAMSNAP_CLIENT_ID and TEAMSNAP_CLIENT_SECRET environment variables."
    );
  }

  try {
    const { authUrl, waitForCallback } = await startOAuthFlow({
      clientId,
      clientSecret,
    });

    // Open browser for authentication
    await open(authUrl);

    // Wait for the callback
    const credentials = await waitForCallback();

    return success({
      status: "authenticated",
      message: "Successfully connected to TeamSnap!",
      user: {
        id: credentials.teamsnapUserId,
        email: credentials.teamsnapEmail,
      },
    });
  } catch (err) {
    return error(`Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleAuthStatus(): Promise<CallToolResult> {
  if (!hasCredentials()) {
    return success({
      authenticated: false,
      message: "Not connected to TeamSnap. Use teamsnap_auth to connect.",
    });
  }

  const credentials = loadCredentials();
  if (!credentials) {
    return success({
      authenticated: false,
      message: "Not connected to TeamSnap. Use teamsnap_auth to connect.",
    });
  }

  // Try to get fresh user info
  teamsnapClient.reloadCredentials();

  try {
    const user = await teamsnapClient.getMe();
    return success({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    });
  } catch {
    return success({
      authenticated: true,
      user: {
        id: credentials.teamsnapUserId,
        email: credentials.teamsnapEmail,
      },
      note: "Could not fetch fresh user info - token may need refresh",
    });
  }
}

async function handleLogout(): Promise<CallToolResult> {
  clearCredentials();
  teamsnapClient.reloadCredentials();
  return success({
    status: "logged_out",
    message: "Successfully disconnected from TeamSnap.",
  });
}

async function handleListTeams(): Promise<CallToolResult> {
  if (!teamsnapClient.isAuthenticated()) {
    teamsnapClient.reloadCredentials();
  }

  try {
    const teams = await teamsnapClient.getTeams();

    const simplified = teams.map((team) => ({
      id: team.id,
      name: team.name,
      sport: team.sport_id,
      division: team.division_name,
      season: team.season_name,
      league: team.league_name,
      isArchived: team.is_archived_season,
    }));

    return success({
      count: simplified.length,
      teams: simplified,
    });
  } catch (err) {
    return error(`Failed to list teams: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleGetTeam(args: ToolArgs): Promise<CallToolResult> {
  const teamId = args.team_id as string | undefined;
  if (!teamId) {
    return error("team_id is required");
  }

  if (!teamsnapClient.isAuthenticated()) {
    teamsnapClient.reloadCredentials();
  }

  try {
    const team = await teamsnapClient.getTeam(teamId);
    return success(team);
  } catch (err) {
    return error(`Failed to get team: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleGetRoster(args: ToolArgs): Promise<CallToolResult> {
  const teamId = args.team_id as string | undefined;
  if (!teamId) {
    return error("team_id is required");
  }

  if (!teamsnapClient.isAuthenticated()) {
    teamsnapClient.reloadCredentials();
  }

  try {
    const members = await teamsnapClient.getTeamMembers(teamId);

    const players = members
      .filter((m) => !m.is_non_player)
      .map((m) => ({
        id: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        jerseyNumber: m.jersey_number,
        position: m.position,
      }));

    const coaches = members
      .filter((m) => m.is_non_player)
      .map((m) => ({
        id: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        isManager: m.is_manager,
        isOwner: m.is_owner,
      }));

    return success({
      teamId,
      playerCount: players.length,
      coachCount: coaches.length,
      players,
      coaches,
    });
  } catch (err) {
    return error(`Failed to get roster: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleGetEvents(args: ToolArgs): Promise<CallToolResult> {
  const teamId = args.team_id as string | undefined;
  if (!teamId) {
    return error("team_id is required");
  }

  if (!teamsnapClient.isAuthenticated()) {
    teamsnapClient.reloadCredentials();
  }

  try {
    let events = await teamsnapClient.getTeamEvents(teamId);

    // Filter by date if provided
    const startDate = args.start_date as string | undefined;
    const endDate = args.end_date as string | undefined;

    if (startDate) {
      const start = new Date(startDate);
      events = events.filter((e) => {
        const eventDate = e.start_date ? new Date(String(e.start_date)) : null;
        return eventDate && eventDate >= start;
      });
    }

    if (endDate) {
      const end = new Date(endDate);
      events = events.filter((e) => {
        const eventDate = e.start_date ? new Date(String(e.start_date)) : null;
        return eventDate && eventDate <= end;
      });
    }

    const simplified = events.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.is_game ? "game" : "practice",
      startDate: e.start_date,
      endDate: e.end_date,
      location: e.location_name,
      opponent: e.opponent_name,
      isHome: e.is_home,
      isCanceled: e.is_canceled,
    }));

    return success({
      teamId,
      count: simplified.length,
      events: simplified,
    });
  } catch (err) {
    return error(`Failed to get events: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleGetEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = args.event_id as string | undefined;
  if (!eventId) {
    return error("event_id is required");
  }

  if (!teamsnapClient.isAuthenticated()) {
    teamsnapClient.reloadCredentials();
  }

  try {
    const event = await teamsnapClient.getEvent(eventId);
    return success(event);
  } catch (err) {
    return error(`Failed to get event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function handleGetAvailability(args: ToolArgs): Promise<CallToolResult> {
  const eventId = args.event_id as string | undefined;
  if (!eventId) {
    return error("event_id is required");
  }

  if (!teamsnapClient.isAuthenticated()) {
    teamsnapClient.reloadCredentials();
  }

  try {
    const availabilities = await teamsnapClient.getAvailabilities(eventId);

    const grouped = {
      yes: [] as Array<{ memberId: unknown; notes: unknown }>,
      no: [] as Array<{ memberId: unknown; notes: unknown }>,
      maybe: [] as Array<{ memberId: unknown; notes: unknown }>,
      noResponse: [] as Array<{ memberId: unknown }>,
    };

    for (const a of availabilities) {
      const status = String(a.status_code || "").toLowerCase();
      const entry = { memberId: a.member_id, notes: a.notes };

      if (status === "yes" || status === "1") {
        grouped.yes.push(entry);
      } else if (status === "no" || status === "0") {
        grouped.no.push(entry);
      } else if (status === "maybe" || status === "2") {
        grouped.maybe.push(entry);
      } else {
        grouped.noResponse.push({ memberId: a.member_id });
      }
    }

    return success({
      eventId,
      summary: {
        available: grouped.yes.length,
        unavailable: grouped.no.length,
        maybe: grouped.maybe.length,
        noResponse: grouped.noResponse.length,
      },
      details: grouped,
    });
  } catch (err) {
    return error(`Failed to get availability: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
