import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { sportName } from "../../utils/sports.js";
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
    const publicSite = (team._links ?? []).find((l) => l.rel === "team_public_site")?.href ?? null;
    const enriched = {
      id: team.id,
      name: team.name,
      sport_id: team.sport_id,
      sport_name: sportName(team.sport_id as number | string | null | undefined),
      division_name: team.division_name,
      division_id: team.division_id,
      season_name: team.season_name,
      league_name: team.league_name,
      league_url: team.league_url,
      is_archived_season: team.is_archived_season,
      is_in_league: team.is_in_league,
      player_member_count: team.player_member_count,
      non_player_member_count: team.non_player_member_count,
      time_zone: team.time_zone,
      time_zone_iana_name: team.time_zone_iana_name,
      time_zone_offset: team.time_zone_offset,
      location_postal_code: team.location_postal_code,
      location_country: team.location_country,
      location_state: team.location_state,
      location_latitude: team.location_latitude,
      location_longitude: team.location_longitude,
      team_public_site_url: publicSite,
    };
    return success(enriched);
  } catch (err) {
    return error(`Failed to get team: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
