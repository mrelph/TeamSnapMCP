import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireExactlyOne, getViewerTZ, type ToolArgs } from "./common.js";

export async function handleGetAssignments(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["team_id", "event_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const scopeParam = `${key}=${value}`;
    const [trackedItems, assignments, statuses] = await Promise.all([
      core.searchMany(`${ENDPOINTS.trackedItems}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.assignments}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.trackedItemStatuses}?${scopeParam}`).catch(() => []),
    ]);
    const tiById = new Map<string, Record<string, unknown>>();
    for (const t of trackedItems) tiById.set(String(t.id), t);
    const statusById = new Map<string, Record<string, unknown>>();
    for (const s of statuses) statusById.set(String(s.id), s);

    let teamId = key === "team_id" ? value : null;
    if (!teamId) {
      const ev = await teamsnapClient.getEvent(value).catch(() => null);
      teamId = ev?.team_id ? String(ev.team_id) : null;
    }
    const members = teamId
      ? await core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`).catch(() => [])
      : [];
    const memberName = new Map<string, string>();
    for (const m of members) memberName.set(String(m.id), `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());

    const tz: string | null = null;
    const tzLabel: string | null = null;
    const viewerTZ = getViewerTZ();

    const items = assignments.map((a) => {
      const trackedItem = tiById.get(String(a.tracked_item_id));
      const statusId = a.tracked_item_status_id;
      const status = statusId ? statusById.get(String(statusId)) : null;
      const statusLabel = (status?.status ?? a.status ?? "pending") as string;
      return {
        assignment_id: a.id,
        tracked_item_id: a.tracked_item_id,
        tracked_item_name: trackedItem?.name ?? null,
        tracked_item_description: trackedItem?.description ?? null,
        member_id: a.member_id,
        member_name: a.member_id ? memberName.get(String(a.member_id)) ?? null : null,
        due_date: localizeTime((trackedItem?.due_date ?? null) as string | null, tz, tzLabel, { viewerTZ }),
        status: statusLabel,
        notes: status?.notes ?? a.notes ?? null,
      };
    });
    return success({
      scope: key === "team_id" ? "team" : "event",
      scope_id: value,
      count: items.length,
      items,
    });
  } catch (err) {
    return error(`Failed to get assignments: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
