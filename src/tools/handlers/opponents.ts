import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetOpponents(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [opponents, results] = await Promise.all([
      core.searchMany(`${ENDPOINTS.opponents}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.opponentsResults}?team_id=${teamId}`).catch(() => []),
    ]);
    const resultsByOpponent = new Map<string, { wins: number; losses: number; ties: number; last_result: string | null }>();
    for (const r of results) {
      const oid = String(r.opponent_id);
      const entry = resultsByOpponent.get(oid) ?? { wins: 0, losses: 0, ties: 0, last_result: null };
      if (r.win === true) entry.wins++;
      else if (r.loss === true) entry.losses++;
      else if (r.tie === true) entry.ties++;
      if (typeof r.formatted_results === "string" && !entry.last_result) {
        entry.last_result = r.formatted_results;
      }
      resultsByOpponent.set(oid, entry);
    }
    const enriched = opponents.map((o) => ({
      id: o.id,
      name: o.name,
      is_current_opponent: o.is_current_opponent ?? false,
      head_to_head: resultsByOpponent.get(String(o.id)) ?? { wins: 0, losses: 0, ties: 0, last_result: null },
    }));
    return success({ team_id: teamId, count: enriched.length, opponents: enriched });
  } catch (err) {
    return error(`Failed to get opponents: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetResultsAndStandings(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [teamResults, standings] = await Promise.all([
      core.searchMany(`${ENDPOINTS.teamResults}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.divisionTeamStandings}?team_id=${teamId}`).catch(() => []),
    ]);
    const record = teamResults.reduce<{ wins: number; losses: number; ties: number; points_for: number; points_against: number }>(
      (acc, r) => ({
        wins: acc.wins + (r.wins ? Number(r.wins) : 0),
        losses: acc.losses + (r.losses ? Number(r.losses) : 0),
        ties: acc.ties + (r.ties ? Number(r.ties) : 0),
        points_for: acc.points_for + (r.points_for ? Number(r.points_for) : 0),
        points_against: acc.points_against + (r.points_against ? Number(r.points_against) : 0),
      }),
      { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 }
    );
    const standingsOut = standings.map((s) => ({
      team_id: s.team_id,
      team_name: s.team_name ?? null,
      position: s.position ?? null,
      games_played: s.games_played ?? null,
      points: s.points ?? null,
    }));
    return success({ team_id: teamId, record, standings: standingsOut });
  } catch (err) {
    return error(`Failed to get results and standings: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
