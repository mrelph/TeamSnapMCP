import { TEAMSNAP_READ_ONLY } from "./config.js";

const readTools = new Set([
  "teamsnap_auth", "teamsnap_auth_status", "teamsnap_logout", "teamsnap_list_teams",
  "teamsnap_get_team", "teamsnap_get_roster", "teamsnap_get_events", "teamsnap_get_event",
  "teamsnap_get_availability", "teamsnap_get_location", "teamsnap_get_contacts",
  "teamsnap_get_announcements", "teamsnap_get_assignments", "teamsnap_get_opponents",
  "teamsnap_get_results_and_standings", "teamsnap_get_member_availability", "teamsnap_get_stats",
  "teamsnap_get_forum_topics", "teamsnap_get_forum_posts", "teamsnap_get_calendar_urls",
  "teamsnap_get_custom_data",
]);

export function isToolAllowed(name: string): boolean {
  return !TEAMSNAP_READ_ONLY || readTools.has(name);
}
