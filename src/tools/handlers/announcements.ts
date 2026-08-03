import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { buildTemplate, checkIdempotency, storeIdempotency, requireConfirm, idempotencyScope } from "../../utils/writeSafety.js";
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

export async function handleSendTeamMessage(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const body = requireString(args, "body");
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = {
    team_id: teamId,
    message: body,
  };

  if (preview) {
    return success({
      preview: true,
      would_post: "messages",
      template: buildTemplate(fields).template,
    });
  }

  const scope = idempotencyScope("teamsnap_send_team_message", teamId, fields);
  const cached = checkIdempotency(scope, idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.messagesBase, fields);
    const result = {
      id: created.id,
      team_id: created.team_id,
      sender_id: created.member_id ?? created.sender_id ?? null,
      body: created.message ?? created.body ?? body,
      sent_at: created.created_at ?? null,
    };
    storeIdempotency(scope, idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to send team message: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleSendAnnouncement(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const channel = requireString(args, "channel").toLowerCase();
  const subject = requireString(args, "subject");
  const body = requireString(args, "body");
  const recipientIds = Array.isArray(args.recipient_member_ids)
    ? (args.recipient_member_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  if (channel !== "email" && channel !== "alert") {
    return error(`channel must be "email" or "alert" (got "${channel}")`);
  }

  const endpoint = channel === "email" ? ENDPOINTS.broadcastEmailsBase : ENDPOINTS.broadcastAlertsBase;
  const fields: Record<string, unknown> = {
    team_id: teamId,
    subject,
    body,
  };
  if (recipientIds && recipientIds.length > 0) {
    fields.recipient_ids = recipientIds;
  }

  if (preview) {
    return success({
      preview: true,
      would_post: endpoint.replace(/^\//, ""),
      recipients: recipientIds ? `${recipientIds.length} specific members` : "entire team",
      template: buildTemplate(fields).template,
      warning: "This will send a real email/alert to recipients. Pass confirm: true to send.",
    });
  }

  const check = requireConfirm(args);
  if (!check.ok) {
    return success({
      preview: true,
      would_post: endpoint.replace(/^\//, ""),
      recipients: recipientIds ? `${recipientIds.length} specific members` : "entire team",
      template: buildTemplate(fields).template,
      blocked: check.reason,
    });
  }

  const scope = idempotencyScope("teamsnap_send_announcement", `${channel}/${teamId}`, fields);
  const cached = checkIdempotency(scope, idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", endpoint, fields);
    const result = {
      id: created.id,
      type: channel,
      team_id: created.team_id,
      subject: created.subject ?? subject,
      body: created.body ?? body,
      sent_at: created.created_at ?? null,
      recipient_count: recipientIds?.length ?? null,
    };
    storeIdempotency(scope, idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to send announcement: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
