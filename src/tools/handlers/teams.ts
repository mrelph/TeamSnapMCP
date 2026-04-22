import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleListTeams(): Promise<CallToolResult> {
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
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
    return success({ count: simplified.length, teams: simplified });
  } catch (err) {
    return error(`Failed to list teams: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetTeam(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const team = await teamsnapClient.getTeam(teamId);
    return success(team);
  } catch (err) {
    return error(`Failed to get team: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
