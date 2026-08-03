import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, type ToolArgs } from "./common.js";

/**
 * Answers "which of my teams am I actually a manager on?" without opening the app.
 *
 * A TeamSnap *user* has one member record per team, and the permission flags live on
 * the member record, not the user. So the question needs the user -> members hop.
 *
 * Read-only by design: this reports permissions, it never changes them.
 */
export async function handleWhoamiMembers(_args: ToolArgs): Promise<CallToolResult> {
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const me = await teamsnapClient.getMe();
    const userId = me.id;
    if (userId === undefined || userId === null) {
      return error("Could not determine the authenticated TeamSnap user id from /me");
    }

    const members = await core.searchMany(`${ENDPOINTS.members}?user_id=${userId}`);

    // Team names come from the caller's own team list; a member record carries only
    // team_id. Missing names are reported as null rather than failing the whole call.
    const teamNameById = new Map<string, unknown>();
    try {
      for (const t of await teamsnapClient.getTeams()) {
        teamNameById.set(String(t.id), t.name ?? null);
      }
    } catch {
      // Team lookup is best-effort enrichment.
    }

    const memberships = members.map((m) => ({
      team_id: m.team_id ?? null,
      team_name: teamNameById.get(String(m.team_id)) ?? null,
      member_id: m.id,
      first_name: m.first_name ?? null,
      last_name: m.last_name ?? null,
      is_manager: m.is_manager ?? false,
      is_owner: m.is_owner ?? false,
      is_commissioner: m.is_commissioner ?? false,
    }));

    memberships.sort((a, b) => String(a.team_name ?? "").localeCompare(String(b.team_name ?? "")));

    return success({
      user: {
        id: userId,
        email: me.email ?? null,
        first_name: me.first_name ?? null,
        last_name: me.last_name ?? null,
      },
      // membership_count counts member RECORDS; a user can hold more than one on a
      // team (e.g. coach and parent-of-player), so team_count is the honest team tally.
      membership_count: memberships.length,
      team_count: new Set(memberships.map((m) => String(m.team_id))).size,
      // Always identifiable: team_name is null whenever the best-effort name lookup
      // failed or the team is archived, and a list of nulls would answer nothing.
      manages: memberships
        .filter((m) => m.is_manager || m.is_owner)
        .map((m) => ({ team_id: m.team_id, team_name: m.team_name })),
      memberships,
    });
  } catch (err) {
    return error(
      `Failed to resolve your member records: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }
}
