import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, requireExactlyOne, type ToolArgs } from "./common.js";

export async function handleGetCalendarUrls(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const team = await teamsnapClient.getTeam(teamId);
    const pick = (rel: string) => team._links?.find((l) => l.rel === rel)?.href ?? null;
    return success({
      team_id: teamId,
      ical_all: pick("calendar_http"),
      webcal_all: pick("calendar_webcal"),
      ical_games_only: pick("calendar_http_games_only"),
      webcal_games_only: pick("calendar_webcal_games_only"),
    });
  } catch (err) {
    return error(`Failed to get calendar URLs: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetCustomData(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["team_id", "member_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const scopeParam = key === "team_id" ? `team_id=${value}` : `member_id=${value}`;
    const [fields, data] = await Promise.all([
      core.searchMany(`${ENDPOINTS.customFields}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.customData}?${scopeParam}`).catch(() => []),
    ]);
    const fieldById = new Map<string, Record<string, unknown>>();
    for (const f of fields) fieldById.set(String(f.id), f);
    const merged = data.map((d) => {
      const field = fieldById.get(String(d.custom_field_id));
      return {
        field_name: field?.name ?? null,
        field_type: field?.data_type ?? null,
        value: d.value,
        member_id: d.member_id ?? null,
        team_id: d.team_id ?? null,
      };
    });
    return success({
      scope: key === "team_id" ? "team" : "member",
      scope_id: value,
      count: merged.length,
      fields: merged,
    });
  } catch (err) {
    return error(`Failed to get custom data: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
