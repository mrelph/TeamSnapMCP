import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tools } from "../src/tools/index.js";
import { handleToolCall } from "../src/tools/handlers/index.js";

// CLAUDE.md: "Adding a tool means editing this array AND the dispatch switch."
// Nothing enforced that, so a tool could be advertised over MCP with no handler
// behind it — the call would fall through to `Unknown tool` only at call time.
describe("tool list <-> dispatch switch parity", () => {
  const switchSource = readFileSync(
    fileURLToPath(new URL("../src/tools/handlers/index.ts", import.meta.url)),
    "utf8"
  );
  const dispatchedNames = new Set(
    Array.from(switchSource.matchAll(/case\s+"([^"]+)":/g), (m) => m[1])
  );

  it("routes every advertised tool to a handler", () => {
    const missing = tools.map((t) => t.name).filter((n) => !dispatchedNames.has(n));
    expect(missing).toEqual([]);
  });

  it("does not dispatch names that are not advertised as tools", () => {
    const advertised = new Set(tools.map((t) => t.name));
    expect([...dispatchedNames].filter((n) => !advertised.has(n))).toEqual([]);
  });

  it("advertises unique tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it("still reports genuinely unknown tools as unknown", async () => {
    const r = await handleToolCall("teamsnap_not_a_real_tool", {});
    expect(r.isError).toBe(true);
    const first = r.content[0];
    expect(first.type === "text" ? first.text : "").toContain("Unknown tool");
  });

  // Scope guard for this milestone: member permissions are reported, never written.
  // Asserted against the SCHEMAS rather than a name denylist — a differently-named
  // tool (teamsnap_promote_member, teamsnap_set_member_flags, ...) would sail past
  // a name check but is caught here the moment it accepts a permission flag.
  it("exposes no tool that accepts a member permission flag as input", () => {
    const PERMISSION_FLAGS = ["is_manager", "is_owner", "is_commissioner"];
    const offenders: string[] = [];

    for (const t of tools) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const [key, schema] of Object.entries(props)) {
        if (PERMISSION_FLAGS.includes(key)) offenders.push(`${t.name}.${key}`);
        // Nested object schemas too — a `permissions: { is_manager }` shape.
        const nested = (schema as { properties?: Record<string, unknown> })?.properties;
        if (nested) {
          for (const nestedKey of Object.keys(nested)) {
            if (PERMISSION_FLAGS.includes(nestedKey)) offenders.push(`${t.name}.${key}.${nestedKey}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("provides the read-only whoami tool, which takes no arguments", () => {
    const whoami = tools.find((t) => t.name === "teamsnap_whoami_members");
    expect(whoami, "teamsnap_whoami_members is missing").toBeDefined();
    const props = (whoami!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(props)).toEqual([]);
  });
});

// Handlers signal bad input by throwing (requireString / requireExactlyOne).
// handleToolCall must convert that into an isError tool result — if it escapes, the
// MCP SDK turns it into a JSON-RPC -32603 "internal error" and the calling model sees
// a protocol failure instead of a message it can act on.
describe("dispatch converts handler throws into tool errors", () => {
  const missingArgCases: Array<[string, RegExp]> = [
    ["teamsnap_get_team", /team_id/],
    ["teamsnap_get_roster", /team_id/],
    ["teamsnap_get_event", /event_id/],
    ["teamsnap_create_event", /team_id/],
    ["teamsnap_update_event", /event_id/],
    ["teamsnap_delete_event", /event_id/],
  ];

  for (const [name, expected] of missingArgCases) {
    it(`${name} with no arguments resolves to an error result, not a rejection`, async () => {
      const r = await handleToolCall(name, {});
      expect(r.isError).toBe(true);
      const first = r.content[0];
      expect(first.type === "text" ? first.text : "").toMatch(expected);
    });
  }
});

// Every write tool must default to preview and advertise that in its schema, so an
// agent cannot mutate a team by calling a tool with only its required arguments.
describe("write tools declare safety rails", () => {
  const writeToolNames = [
    "teamsnap_set_availability",
    "teamsnap_update_tracked_item_status",
    "teamsnap_create_tracked_item",
    "teamsnap_assign_tracked_item",
    "teamsnap_create_event",
    "teamsnap_update_event",
    "teamsnap_delete_event",
    "teamsnap_send_team_message",
    "teamsnap_send_announcement",
  ];

  for (const name of writeToolNames) {
    it(`${name} exposes a preview flag and does not require it`, () => {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} is not in the tool list`).toBeDefined();
      const props = tool!.inputSchema.properties as Record<string, unknown> | undefined;
      expect(props, `${name} has no input properties`).toBeDefined();
      expect(props).toHaveProperty("preview");
      const required = (tool!.inputSchema.required ?? []) as string[];
      expect(required).not.toContain("preview");
      expect(required).not.toContain("confirm");
    });
  }
});
