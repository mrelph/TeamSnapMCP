import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
const mocks = vi.hoisted(() => ({ write: vi.fn(), delete: vi.fn(), getEvent: vi.fn() }));
vi.mock("../../src/api/client.js", () => ({ teamsnapClient: {
  isAuthenticated: () => true, reloadCredentials: vi.fn(),
  getEvent: mocks.getEvent, getCore: () => ({ write: mocks.write, delete: mocks.delete }),
} }));
import { handleToolCall } from "../../src/tools/handlers/index.js";
import { tools } from "../../src/tools/index.js";
import { __clearIdempotencyCache } from "../../src/utils/writeSafety.js";

function body(r: CallToolResult) {
  expect(r.isError).not.toBe(true);
  const item = r.content[0];
  if (item.type !== "text") throw new Error("Expected text");
  return JSON.parse(item.text);
}
function text(r: CallToolResult) { return r.content[0].type === "text" ? r.content[0].text : ""; }
const event = { id: 123, team_id: 456, name: "Sabres placeholder", is_game: true, is_tbd: true,
  start_date: "2027-01-23T17:00:00Z", time_zone_iana_name: "America/New_York",
  location_name: "Buffalo Area - TBD", opponent_name: "Jr Sabres", repeating_type: "Weekly" };
const create = { team_id: "456", name: "Jr Sabres", is_game: true, is_tbd: false, start_date: "2027-01-23T18:00:00Z" };
const notify = { notify_team: true, notify_team_as_member_id: "789" };
const deletion = { event_id: "123", team_id: "456" };

beforeEach(() => {
  vi.clearAllMocks(); __clearIdempotencyCache();
  mocks.write.mockResolvedValue(event); mocks.delete.mockResolvedValue(undefined); mocks.getEvent.mockResolvedValue(event);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in handler tests"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("notified event creation and update", () => {
  it("previews a game with notification explicitly disabled and no network", async () => {
    const r = body(await handleToolCall("teamsnap_create_event", create));
    expect(r.status).toBe("preview");
    expect(r.template.data).toEqual(expect.arrayContaining([
      { name: "is_game", value: true }, { name: "is_tbd", value: false }, { name: "notify_team", value: false },
    ]));
    expect(mocks.write).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["teamsnap_create_event", "teamsnap_update_event"])("blocks %s notification without confirm", async (tool) => {
    const args = tool.includes("create") ? create : { event_id: "123", patch: { is_tbd: false } };
    const r = body(await handleToolCall(tool, { ...args, ...notify, preview: false }));
    expect(r.status).toBe("blocked"); expect(r.blocked).toContain("confirm: true"); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["teamsnap_create_event", "teamsnap_update_event"])("requires sender and real boolean for %s", async (tool) => {
    const args = tool.includes("create") ? create : { event_id: "123", patch: { is_tbd: false } };
    for (const extra of [{ notify_team: true }, { notify_team: "false" }, { ...notify, notify_team_as_member_id: "bad" }]) {
      expect((await handleToolCall(tool, { ...args, ...extra, preview: false, confirm: true })).isError).toBe(true);
    }
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("commits native notification fields, not a broadcast, and reports delivery unverified", async () => {
    const r = body(await handleToolCall("teamsnap_create_event", { ...create, ...notify, preview: false, confirm: true }));
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledWith("POST", "/events", expect.objectContaining({ ...notify, is_game: true, is_tbd: false }));
    expect(r).toMatchObject({ status: "committed", notifications: { requested: true, sending_member_id: "789", delivery: "not_verified" } });
  });
  it("ordinary updates send notification false and support game/TBD conversion", async () => {
    const r = body(await handleToolCall("teamsnap_update_event", { event_id: "123", patch: { is_game: true, is_tbd: false }, preview: false }));
    expect(mocks.write).toHaveBeenCalledWith("PATCH", "/events/123", { is_game: true, is_tbd: false, notify_team: false });
    expect(r.status).toBe("committed");
  });
  it("preserves cancellation confirmation but does not promise it automatically notifies", async () => {
    const r = body(await handleToolCall("teamsnap_update_event", { event_id: "123", patch: { is_canceled: true }, preview: false }));
    expect(r.status).toBe("blocked"); expect(r.warning).toContain("does not delete"); expect(r.notifications.requested).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects patch notification overrides and wrong boolean types", async () => {
    for (const patch of [{ notify_team: true }, { is_tbd: "false" }, { is_canceled: "true" }, []]) {
      expect((await handleToolCall("teamsnap_update_event", { event_id: "123", patch, preview: false })).isError).toBe(true);
    }
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("deduplicates identical creations and rejects reuse with changed fields", async () => {
    const args = { ...create, ...notify, preview: false, confirm: true, idempotency_key: "same" };
    body(await handleToolCall("teamsnap_create_event", args));
    expect(body(await handleToolCall("teamsnap_create_event", args)).idempotent_replay).toBe(true);
    const r = await handleToolCall("teamsnap_create_event", { ...args, start_date: "2027-01-23T22:30:00Z" });
    expect(r.isError).toBe(true); expect(text(r)).toContain("different event fields"); expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("on a lost write response tells the caller to inspect before retrying", async () => {
    mocks.write.mockRejectedValue(new Error("connection lost after commit"));
    const r = await handleToolCall("teamsnap_create_event", { ...create, ...notify, preview: false, confirm: true });
    expect(r.isError).toBe(true); expect(text(r)).toContain("inspect the schedule before retrying"); expect(mocks.write).toHaveBeenCalledOnce();
  });
});

describe("single-event deletion", () => {
  it("is registered and previews a recognizable target without deleting", async () => {
    expect(tools.find(t => t.name === "teamsnap_delete_event")?.inputSchema.required).toEqual(["event_id", "team_id"]);
    const r = body(await handleToolCall("teamsnap_delete_event", deletion));
    expect(r).toMatchObject({ status: "preview", scope: "single_event_only", target: { id: 123, team_id: 456, name: "Sabres placeholder" }, parameters: { repeating_include: "none", notify_team: false } });
    expect(r.target.start.local).toContain("Jan 23, 2027"); expect(r.warning).toContain("availability");
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("cannot commit deletion without true confirmation", async () => {
    const r = body(await handleToolCall("teamsnap_delete_event", { ...deletion, preview: false, confirm: "true" }));
    expect(r.status).toBe("blocked"); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each([{ id: 124 }, { team_id: 457 }, { team_id: undefined }])("blocks mismatched or unverifiable target %o", async (bad) => {
    mocks.getEvent.mockResolvedValue({ ...event, ...bad });
    const r = await handleToolCall("teamsnap_delete_event", { ...deletion, preview: false, confirm: true });
    expect(r.isError).toBe(true); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("rejects malformed identifiers before fetching", async () => {
    const r = await handleToolCall("teamsnap_delete_event", { ...deletion, event_id: "123?team_id=999", preview: false, confirm: true });
    expect(r.isError).toBe(true); expect(mocks.getEvent).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("rechecks target on commit and only deletes this recurring occurrence", async () => {
    await handleToolCall("teamsnap_delete_event", deletion);
    const r = body(await handleToolCall("teamsnap_delete_event", { ...deletion, ...notify, preview: false, confirm: true }));
    expect(mocks.getEvent).toHaveBeenCalledTimes(2);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledWith("/events/123", { repeating_include: "none", ...notify });
    expect(r).toMatchObject({ status: "committed", deleted: true, notifications: { requested: true, delivery: "not_verified" } });
  });
  it("stops if the event moved teams after preview", async () => {
    await handleToolCall("teamsnap_delete_event", deletion);
    mocks.getEvent.mockResolvedValue({ ...event, team_id: 457 });
    expect((await handleToolCall("teamsnap_delete_event", { ...deletion, preview: false, confirm: true })).isError).toBe(true);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("does not call an already absent target deleted", async () => {
    mocks.getEvent.mockRejectedValue(new Error("not found"));
    const r = await handleToolCall("teamsnap_delete_event", { ...deletion, preview: false, confirm: true });
    expect(r.isError).toBe(true); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("returns an error and uncertain-outcome guidance on network loss", async () => {
    mocks.delete.mockRejectedValue(new Error("network lost"));
    const r = await handleToolCall("teamsnap_delete_event", { ...deletion, preview: false, confirm: true });
    expect(r.isError).toBe(true); expect(text(r)).toContain("re-read the event before retrying"); expect(mocks.delete).toHaveBeenCalledOnce();
  });
});
