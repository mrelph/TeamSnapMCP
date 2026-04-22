import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";
import { ENDPOINTS } from "../../api/endpoints.js";

const STATUS_TO_CODE: Record<string, number> = { yes: 1, no: 0, maybe: 2 };

export async function handleGetAvailability(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const availabilities = await teamsnapClient.getAvailabilities(eventId);
    const grouped = {
      yes: [] as Array<{ memberId: unknown; notes: unknown }>,
      no: [] as Array<{ memberId: unknown; notes: unknown }>,
      maybe: [] as Array<{ memberId: unknown; notes: unknown }>,
      noResponse: [] as Array<{ memberId: unknown }>,
    };
    for (const a of availabilities) {
      const status = String(a.status_code ?? "").toLowerCase();
      const entry = { memberId: a.member_id, notes: a.notes };
      if (status === "yes" || status === "1") grouped.yes.push(entry);
      else if (status === "no" || status === "0") grouped.no.push(entry);
      else if (status === "maybe" || status === "2") grouped.maybe.push(entry);
      else grouped.noResponse.push({ memberId: a.member_id });
    }
    return success({
      eventId,
      summary: {
        available: grouped.yes.length,
        unavailable: grouped.no.length,
        maybe: grouped.maybe.length,
        noResponse: grouped.noResponse.length,
      },
      details: grouped,
    });
  } catch (err) {
    return error(`Failed to get availability: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleSetAvailability(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  const memberId = requireString(args, "member_id");
  const status = requireString(args, "status").toLowerCase();
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  const preview = args.preview !== false;

  if (!(status in STATUS_TO_CODE)) {
    return error(`status must be one of: yes, no, maybe (got "${status}")`);
  }
  const statusCode = STATUS_TO_CODE[status];

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const existing = await core.searchOne(
      `${ENDPOINTS.availabilities}?event_id=${eventId}&member_id=${memberId}`
    );
    if (!existing?.id) {
      return error(`No availability record found for event_id=${eventId}, member_id=${memberId}`);
    }
    const availabilityId = String(existing.id);
    const fields: Record<string, unknown> = { status_code: statusCode };
    if (notes !== undefined) fields.notes = notes;

    if (preview) {
      return success({
        preview: true,
        would_patch: `availability ${availabilityId}`,
        event_id: eventId,
        member_id: memberId,
        with: { status, status_code: statusCode, notes: notes ?? null },
      });
    }

    const updated = await core.write("PATCH", ENDPOINTS.availabilityById(availabilityId), fields);
    return success({
      status_code: updated.status_code,
      status,
      event_id: eventId,
      member_id: memberId,
      notes: updated.notes ?? null,
    });
  } catch (err) {
    return error(`Failed to set availability: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
