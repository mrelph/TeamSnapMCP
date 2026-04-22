import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetStats(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const scope = typeof args.scope === "string" ? args.scope : "team";
  const memberId = typeof args.member_id === "string" ? args.member_id : null;
  const eventId = typeof args.event_id === "string" ? args.event_id : null;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    let endpoint: string;
    const params = new URLSearchParams({ team_id: teamId });
    switch (scope) {
      case "member":
        if (!memberId) return error("member_id required when scope=member");
        endpoint = ENDPOINTS.memberStatistics;
        params.set("member_id", memberId);
        break;
      case "event":
        if (!eventId) return error("event_id required when scope=event");
        endpoint = ENDPOINTS.eventStatistics;
        params.set("event_id", eventId);
        break;
      case "team":
      default:
        endpoint = ENDPOINTS.teamStatistics;
    }
    const [defs, data] = await Promise.all([
      core.searchMany(`${ENDPOINTS.statistics}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${endpoint}?${params.toString()}`).catch(() => []),
    ]);
    const defById = new Map<string, Record<string, unknown>>();
    for (const d of defs) defById.set(String(d.id), d);
    const items = data.map((s) => {
      const def = defById.get(String(s.statistic_id));
      return {
        statistic_id: s.statistic_id,
        statistic_name: def?.name ?? null,
        unit: def?.unit ?? null,
        value: s.value,
        member_id: s.member_id ?? null,
        event_id: s.event_id ?? null,
      };
    });
    return success({ team_id: teamId, scope, count: items.length, items });
  } catch (err) {
    return error(`Failed to get stats: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
