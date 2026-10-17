import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("read-only configuration", () => {
  it.each([
    [undefined, "read write"], ["false", "read write"], ["true", "read"],
  ])("setting %s requests %s", async (setting, scope) => {
    vi.stubEnv("TEAMSNAP_READ_ONLY", setting);
    const config = await import("../src/utils/config.js");
    expect(config.TEAMSNAP_SCOPES).toBe(scope);
  });

  it("rejects an ambiguous setting instead of silently allowing writes", async () => {
    vi.stubEnv("TEAMSNAP_READ_ONLY", "yes");
    await expect(import("../src/utils/config.js")).rejects.toThrow("must be true or false");
  });
});

describe("actual local MCP transport", () => {
  it.each(["true", "false"])("enforces discovery and dispatch with mode %s", async mode => {
    const home = await mkdtemp(join(tmpdir(), "teamsnap-test-"));
    const client = new Client({ name: "read-only-test", version: "1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { HOME: home, TEAMSNAP_READ_ONLY: mode },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toContain("teamsnap_get_custom_data");
      expect(names).toContain("teamsnap_logout");
      if (mode === "false") {
        expect(names).toContain("teamsnap_set_availability");
        expect(names).toHaveLength(29);
      } else {
        expect(names).toHaveLength(21);
        const writes = [
          "teamsnap_set_availability", "teamsnap_update_tracked_item_status",
          "teamsnap_create_tracked_item", "teamsnap_assign_tracked_item",
          "teamsnap_create_event", "teamsnap_update_event",
          "teamsnap_send_team_message", "teamsnap_send_announcement",
        ];
        for (const name of writes) {
          expect(names).not.toContain(name);
          const result = await client.callTool({ name, arguments: { preview: true } });
          expect(result.isError).toBe(true);
          expect(result.content).toEqual([{ type: "text", text: "Read-only mode does not allow this tool." }]);
        }
        const status = await client.callTool({ name: "teamsnap_auth_status", arguments: {} });
        expect(JSON.parse((status.content as Array<{ text: string }>)[0].text).authenticated).toBe(false);
      }
    } finally {
      await client.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
