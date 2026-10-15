import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as root from "../src/utils/remoteMcp.js";
import * as packaged from "../packages/mcp-client/src/remoteMcp.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("keeps the standalone and root transport safety policy identical", () => {
  expect(readFileSync("src/utils/remoteMcp.ts", "utf8")).toBe(readFileSync("packages/mcp-client/src/remoteMcp.ts", "utf8"));
});
for (const [name, bridge] of [["root", root], ["standalone", packaged]] as const) {
  describe(`${name} bridge replay safety`, () => {
    it.each(["teamsnap_create_event", "teamsnap_update_event", "teamsnap_delete_event"])("never retries a committed %s after a dropped response", async (tool) => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("response lost after remote commit")); vi.stubGlobal("fetch", fetchMock);
      await expect(bridge.callRemoteMCP("https://example.test/mcp", "tools/call", { name: tool, arguments: { preview: false, notify_team: true, confirm: true } })).rejects.toThrow("Outcome unknown");
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    it.each([new Response("bad gateway", { status: 502 }), new Response("not JSON", { status: 200 }), new Response("{}", { status: 200 })])("does not replay a commit after HTTP/malformed-response failure", async (response) => {
      const fetchMock = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetchMock);
      await expect(bridge.callRemoteMCP("https://example.test/mcp", "tools/call", { name: "teamsnap_create_event", arguments: { preview: false } })).rejects.toThrow("not automatically replayed");
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    it("retains retries for previews", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error("cold start")).mockResolvedValueOnce(new Response('{"result":{"preview":true}}'));
      vi.stubGlobal("fetch", fetchMock);
      const pending = bridge.callRemoteMCP("https://example.test/mcp", "tools/call", { name: "teamsnap_delete_event", arguments: {} });
      await vi.runAllTimersAsync(); expect(await pending).toEqual({ preview: true }); expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("classifies unknown calls and authentication conservatively", () => {
      expect(bridge.canRetryRemoteCall("tools/list")).toBe(true);
      expect(bridge.canRetryRemoteCall("tools/call", { name: "teamsnap_get_events" })).toBe(true);
      expect(bridge.canRetryRemoteCall("tools/call", { name: "teamsnap_new_write" })).toBe(false);
      expect(bridge.canRetryRemoteCall("tools/call", { name: "teamsnap_auth" })).toBe(false);
    });
  });
}
