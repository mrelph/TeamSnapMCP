import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

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
