import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireString, requireExactlyOne, getViewerTZ, type ToolArgs } from "./common.js";
import { buildTemplate, checkIdempotency, storeIdempotency, idempotencyScope } from "../../utils/writeSafety.js";

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

const TRACKED_STATUS_VALID = ["pending", "claimed", "complete"] as const;
type TrackedStatus = (typeof TRACKED_STATUS_VALID)[number];

function buildStatusFields(status: TrackedStatus, notes?: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {};
  if (status === "pending") {
    fields.claimed_at = null;
    fields.completed_at = null;
  } else if (status === "claimed") {
    fields.claimed_at = now;
    fields.completed_at = null;
  } else {
    fields.completed_at = now;
  }
  if (notes !== undefined) fields.notes = notes;
  return fields;
}

export async function handleUpdateTrackedItemStatus(args: ToolArgs): Promise<CallToolResult> {
  const statusId = requireString(args, "tracked_item_status_id");
  const status = requireString(args, "status").toLowerCase() as TrackedStatus;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  const preview = args.preview !== false;

  if (!TRACKED_STATUS_VALID.includes(status)) {
    return error(`status must be one of: ${TRACKED_STATUS_VALID.join(", ")} (got "${status}")`);
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const fields = buildStatusFields(status, notes);

    if (preview) {
      return success({
        preview: true,
        would_patch: `tracked_item_status ${statusId}`,
        with: { status, ...fields },
      });
    }

    const updated = await core.write(
      "PATCH",
      ENDPOINTS.trackedItemStatusById(statusId),
      fields
    );
    return success({
      id: updated.id,
      tracked_item_id: updated.tracked_item_id,
      member_id: updated.member_id,
      status,
      claimed_at: updated.claimed_at ?? null,
      completed_at: updated.completed_at ?? null,
      notes: updated.notes ?? null,
    });
  } catch (err) {
    return error(`Failed to update tracked item status: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleCreateTrackedItem(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const name = requireString(args, "name");
  const eventId = typeof args.event_id === "string" ? args.event_id : undefined;
  const dueDate = typeof args.due_date === "string" ? args.due_date : undefined;
  const description = typeof args.description === "string" ? args.description : undefined;
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = { team_id: teamId, name };
  if (eventId !== undefined) fields.event_id = eventId;
  if (dueDate !== undefined) fields.due_date = dueDate;
  if (description !== undefined) fields.description = description;

  if (preview) {
    return success({
      preview: true,
      would_post: "tracked_items",
      template: buildTemplate(fields).template,
    });
  }

  const scope = idempotencyScope("teamsnap_create_tracked_item", teamId, fields);
  const cached = checkIdempotency(scope, idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.trackedItemsBase, fields);
    const result = {
      id: created.id,
      team_id: created.team_id,
      event_id: created.event_id ?? null,
      name: created.name,
      due_date: created.due_date ?? null,
      description: created.description ?? null,
    };
    storeIdempotency(scope, idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to create tracked item: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleAssignTrackedItem(args: ToolArgs): Promise<CallToolResult> {
  const trackedItemId = requireString(args, "tracked_item_id");
  const memberId = requireString(args, "member_id");
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = {
    tracked_item_id: trackedItemId,
    member_id: memberId,
  };

  if (preview) {
    return success({
      preview: true,
      would_post: "assignments",
      template: buildTemplate(fields).template,
    });
  }

  const scope = idempotencyScope("teamsnap_assign_tracked_item", `${trackedItemId}/${memberId}`, fields);
  const cached = checkIdempotency(scope, idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.assignmentsBase, fields);
    const result = {
      id: created.id,
      tracked_item_id: created.tracked_item_id,
      member_id: created.member_id,
    };
    storeIdempotency(scope, idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to assign tracked item: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
