import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, type ToolArgs } from "./common.js";
import { handleAuth, handleAuthStatus, handleLogout } from "./auth.js";
import { handleListTeams, handleGetTeam } from "./teams.js";
import { handleGetRoster, handleGetContacts, handleGetMemberAvailability } from "./roster.js";
import {
  handleGetEvents,
  handleGetEvent,
  handleGetLocation,
  handleCreateEvent,
  handleUpdateEvent,
} from "./events.js";
import { handleGetAvailability, handleSetAvailability } from "./availability.js";
import { handleGetCalendarUrls, handleGetCustomData } from "./meta.js";
import {
  handleGetAnnouncements,
  handleSendTeamMessage,
  handleSendAnnouncement,
} from "./announcements.js";
import {
  handleGetAssignments,
  handleCreateTrackedItem,
  handleAssignTrackedItem,
  handleUpdateTrackedItemStatus,
} from "./assignments.js";
import { handleGetOpponents, handleGetResultsAndStandings } from "./opponents.js";
import { handleGetStats } from "./stats.js";
import { handleGetForumTopics, handleGetForumPosts } from "./forum.js";

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
      case "teamsnap_get_location":
        return handleGetLocation(args);
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
      case "teamsnap_get_forum_topics":
        return handleGetForumTopics(args);
      case "teamsnap_get_forum_posts":
        return handleGetForumPosts(args);
      case "teamsnap_set_availability":
        return handleSetAvailability(args);
      case "teamsnap_update_tracked_item_status":
        return handleUpdateTrackedItemStatus(args);
      case "teamsnap_create_tracked_item":
        return handleCreateTrackedItem(args);
      case "teamsnap_assign_tracked_item":
        return handleAssignTrackedItem(args);
      case "teamsnap_create_event":
        return handleCreateEvent(args);
      case "teamsnap_update_event":
        return handleUpdateEvent(args);
      case "teamsnap_send_team_message":
        return handleSendTeamMessage(args);
      case "teamsnap_send_announcement":
        return handleSendAnnouncement(args);
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
