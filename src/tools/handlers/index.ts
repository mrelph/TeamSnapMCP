import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, type ToolArgs } from "./common.js";
import { handleAuth, handleAuthStatus, handleLogout } from "./auth.js";
import { handleListTeams, handleGetTeam } from "./teams.js";
import { handleGetRoster, handleGetContacts, handleGetMemberAvailability } from "./roster.js";
import { handleGetEvents, handleGetEvent } from "./events.js";
import { handleGetAvailability } from "./availability.js";
import { handleGetCalendarUrls, handleGetCustomData } from "./meta.js";
import { handleGetAnnouncements } from "./announcements.js";
import { handleGetAssignments } from "./assignments.js";
import { handleGetOpponents, handleGetResultsAndStandings } from "./opponents.js";
import { handleGetStats } from "./stats.js";

export async function handleToolCall(name: string, args: ToolArgs): Promise<CallToolResult> {
  try {
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
      case "teamsnap_get_calendar_urls":
        return handleGetCalendarUrls(args);
      case "teamsnap_get_custom_data":
        return handleGetCustomData(args);
      case "teamsnap_get_contacts":
        return handleGetContacts(args);
      case "teamsnap_get_announcements":
        return handleGetAnnouncements(args);
      case "teamsnap_get_assignments":
        return handleGetAssignments(args);
      case "teamsnap_get_opponents":
        return handleGetOpponents(args);
      case "teamsnap_get_results_and_standings":
        return handleGetResultsAndStandings(args);
      case "teamsnap_get_member_availability":
        return handleGetMemberAvailability(args);
      case "teamsnap_get_stats":
        return handleGetStats(args);
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
