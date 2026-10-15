// Kept identical in src/utils/remoteMcp.ts and the standalone bridge package.
// A dropped response does not mean that a committed write was rolled back.
const READ_TOOLS = new Set([
  "teamsnap_auth_status", "teamsnap_list_teams", "teamsnap_get_team", "teamsnap_get_roster",
  "teamsnap_get_events", "teamsnap_get_event", "teamsnap_get_location", "teamsnap_get_availability",
  "teamsnap_get_contacts", "teamsnap_get_announcements", "teamsnap_get_assignments",
  "teamsnap_get_opponents", "teamsnap_get_results_and_standings", "teamsnap_get_member_availability",
  "teamsnap_get_stats", "teamsnap_get_forum_topics", "teamsnap_get_forum_posts",
  "teamsnap_get_calendar_urls", "teamsnap_get_custom_data",
]);
const PREVIEW_TOOLS = new Set([
  "teamsnap_set_availability", "teamsnap_update_tracked_item_status", "teamsnap_create_tracked_item",
  "teamsnap_assign_tracked_item", "teamsnap_create_event", "teamsnap_update_event",
  "teamsnap_delete_event", "teamsnap_send_team_message", "teamsnap_send_announcement",
]);

export function canRetryRemoteCall(method: string, params?: unknown): boolean {
  if (method === "tools/list" || method === "initialize") return true;
  if (method !== "tools/call" || !params || typeof params !== "object") return false;
  const { name, arguments: args } = params as { name?: string; arguments?: Record<string, unknown> };
  if (!name) return false;
  if (READ_TOOLS.has(name)) return true;
  return PREVIEW_TOOLS.has(name) && args?.preview !== false;
}

export async function callRemoteMCP(endpoint: string, method: string, params?: unknown): Promise<unknown> {
  const retrySafe = canRetryRemoteCall(method, params);
  const attempts = retrySafe ? 3 : 1;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      if (!response.ok) throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
      const data = await response.json() as { result?: unknown; error?: { message: string } };
      if (data.error) throw new Error(data.error.message);
      if (!("result" in data)) throw new Error("Malformed MCP response: missing result");
      return data.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt + 1}/${attempts} failed for ${method}: ${lastError.message}`);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  if (!retrySafe) {
    throw new Error(`Outcome unknown: ${lastError?.message}. This call was not automatically replayed. Inspect TeamSnap state before resubmitting; an event or notification may already have committed.`);
  }
  throw lastError;
}
