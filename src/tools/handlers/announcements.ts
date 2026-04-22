import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireString, getViewerTZ, type ToolArgs } from "./common.js";

function normalize(
  item: Record<string, unknown>,
  type: "email" | "alert" | "message"
): { id: unknown; type: string; subject: unknown; body: unknown; sender_id: unknown; sent_at: string | null } {
  return {
    id: item.id,
    type,
    subject: item.subject ?? item.title ?? null,
    body: item.body ?? item.message ?? null,
    sender_id: item.member_id ?? item.sender_id ?? item.user_id ?? null,
    sent_at: (item.created_at ?? item.sent_at ?? null) as string | null,
  };
}

export async function handleGetAnnouncements(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const since = typeof args.since === "string" ? args.since : null;
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [emails, alerts, messages, members] = await Promise.all([
      core.searchMany(`${ENDPOINTS.broadcastEmails}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.broadcastAlerts}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.messages}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`).catch(() => []),
    ]);
    const memberName = new Map<string, string>();
    for (const m of members) {
      memberName.set(String(m.id), `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
    }
    const normalized = [
      ...emails.map((e) => normalize(e, "email")),
      ...alerts.map((a) => normalize(a, "alert")),
      ...messages.map((m) => normalize(m, "message")),
    ];
    const filtered = since ? normalized.filter((n) => n.sent_at && new Date(n.sent_at) >= new Date(since)) : normalized;
    filtered.sort((a, b) => {
      const aT = a.sent_at ? new Date(a.sent_at).getTime() : 0;
      const bT = b.sent_at ? new Date(b.sent_at).getTime() : 0;
      return bT - aT;
    });
    const sliced = filtered.slice(0, limit);
    const viewerTZ = getViewerTZ();
    const team = await teamsnapClient.getTeam(teamId).catch(() => null);
    const tz = (team?.time_zone_iana_name as string | null | undefined) ?? null;
    const tzLabel = (team?.time_zone as string | null | undefined) ?? null;
    const items = sliced.map((n) => ({
      id: n.id,
      type: n.type,
      subject: n.subject,
      body_preview: typeof n.body === "string" ? n.body.slice(0, 200) : n.body,
      sender_id: n.sender_id,
      sender_name: n.sender_id ? memberName.get(String(n.sender_id)) ?? null : null,
      sent_at: localizeTime(n.sent_at, tz, tzLabel, { viewerTZ }),
    }));
    return success({
      team_id: teamId,
      count: items.length,
      total: filtered.length,
      items,
    });
  } catch (err) {
    return error(`Failed to get announcements: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
