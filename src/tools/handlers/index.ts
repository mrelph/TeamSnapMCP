import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, type ToolArgs } from "./common.js";
import { handleAuth, handleAuthStatus, handleLogout } from "./auth.js";
import { handleListTeams, handleGetTeam } from "./teams.js";
import { handleGetRoster, handleGetContacts } from "./roster.js";
import { handleGetEvents, handleGetEvent } from "./events.js";
import { handleGetAvailability } from "./availability.js";
import { handleGetCalendarUrls, handleGetCustomData } from "./meta.js";

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
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
