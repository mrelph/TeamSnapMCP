import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetRoster(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
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
