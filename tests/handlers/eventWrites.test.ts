import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCreateEvent, handleUpdateEvent, handleDeleteEvent } from "../../src/tools/handlers/events.js";
import { __clearIdempotencyCache } from "../../src/utils/writeSafety.js";

// Backfill coverage for teamsnap_create_event / teamsnap_update_event, which shipped
// without any tests. Validation and preview run before the auth check, so these are
// deterministic without credentials — they never degrade into a skipped no-op.

const originalFetch = globalThis.fetch;

function parse(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  return JSON.parse(first.type === "text" ? (first.text ?? "") : "");
}

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  return first.type === "text" ? (first.text ?? "") : "";
}

function fieldsOf(template: { data: Array<{ name: string; value: unknown }> }) {
  return Object.fromEntries(template.data.map((d) => [d.name, d.value]));
}

const writeSpy = vi.fn();
const removeSpy = vi.fn();
const getEventSpy = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  teamsnapClient: {
    isAuthenticated: () => true,
    reloadCredentials: () => {},
    getCore: () => ({ write: writeSpy, remove: removeSpy }),
    getEvent: (...a: unknown[]) => getEventSpy(...a),
  },
}));

describe("handleCreateEvent preview", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    writeSpy.mockReset();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("preview must not touch the network");
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires team_id, name and start_date", async () => {
    await expect(handleCreateEvent({ name: "x", start_date: "2026-06-14T19:00:00Z" })).rejects.toThrow(/team_id/);
    await expect(handleCreateEvent({ team_id: "1", start_date: "2026-06-14T19:00:00Z" })).rejects.toThrow(/name/);
    await expect(handleCreateEvent({ team_id: "1", name: "x" })).rejects.toThrow(/start_date/);
  });

  it("previews by default and does not write", async () => {
    const r = await handleCreateEvent({
      team_id: "10413186",
      name: "Captain's Practice",
      start_date: "2026-06-14T19:00:00Z",
    });
    const p = parse(r);
    expect(p.preview).toBe(true);
    expect(p.would_post).toBe("events");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("defaults is_game to false when omitted", async () => {
    const r = await handleCreateEvent({
      team_id: "1", name: "Practice", start_date: "2026-06-14T19:00:00Z",
    });
    expect(fieldsOf(parse(r).template).is_game).toBe(false);
  });

  it("omits optional fields that were not supplied", async () => {
    const r = await handleCreateEvent({
      team_id: "1", name: "Practice", start_date: "2026-06-14T19:00:00Z",
    });
    const f = fieldsOf(parse(r).template);
    expect(f).toEqual({
      team_id: "1", name: "Practice", start_date: "2026-06-14T19:00:00Z", is_game: false,
    });
    expect(f).not.toHaveProperty("notes");
    expect(f).not.toHaveProperty("location_id");
  });

  // David's explicit regression requirement: arrival must ride on the event's own
  // arrival field. It must NEVER be implemented by subtracting from start_date —
  // start_date is the real face-off time and has to go out verbatim.
  it("sets the native arrival field and leaves start_date completely untouched", async () => {
    const START = "2026-06-14T19:00:00Z";
    const r = await handleCreateEvent({
      team_id: "1", name: "Game", start_date: START,
      is_game: true, arrival_minutes_early: 30,
    });
    const f = fieldsOf(parse(r).template);

    expect(f.minutes_to_arrive_early).toBe(30);
    // The exact byte-for-byte start time the caller supplied.
    expect(f.start_date).toBe(START);
    // Nothing derived: no shifted start, no separate arrival timestamp, no raw arg.
    expect(f).not.toHaveProperty("arrival_minutes_early");
    expect(f).not.toHaveProperty("arrival_date");
    expect(new Date(String(f.start_date)).toISOString()).toBe(new Date(START).toISOString());
  });

  it("does not shift start_date for any arrival value", async () => {
    for (const minutes of [0, 15, 30, 60, 120]) {
      const r = await handleCreateEvent({
        team_id: "1", name: "Game", start_date: "2026-06-14T19:00:00Z",
        arrival_minutes_early: minutes,
      });
      const f = fieldsOf(parse(r).template);
      expect(f.start_date, `start_date shifted for arrival=${minutes}`).toBe("2026-06-14T19:00:00Z");
    }
  });

  it("carries through the remaining optional fields", async () => {
    const r = await handleCreateEvent({
      team_id: "1", name: "Game", start_date: "2026-06-14T19:00:00Z",
      is_game: true, duration_in_minutes: 90, location_id: "77",
      opponent_id: "88", notes: "bring pucks", uniform: "home whites",
    });
    expect(fieldsOf(parse(r).template)).toMatchObject({
      is_game: true, duration_in_minutes: 90, location_id: "77",
      opponent_id: "88", notes: "bring pucks", uniform: "home whites",
    });
  });
});

describe("handleCreateEvent execution", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    writeSpy.mockReset();
    writeSpy.mockResolvedValue({
      id: 999, name: "Captain's Practice", start_date: "2026-06-14T19:00:00Z",
      is_game: false, time_zone_iana_name: "America/Los_Angeles",
    });
  });

  it("POSTs to the events collection when preview is false", async () => {
    const r = await handleCreateEvent({
      team_id: "1", name: "Captain's Practice", start_date: "2026-06-14T19:00:00Z", preview: false,
    });
    expect(r.isError).toBeFalsy();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [method, endpoint] = writeSpy.mock.calls[0];
    expect(method).toBe("POST");
    expect(endpoint).toBe("/events");
  });

  it("replays a cached result for a repeated idempotency_key without a second POST", async () => {
    const args = {
      team_id: "1", name: "Practice", start_date: "2026-06-14T19:00:00Z",
      preview: false, idempotency_key: "evt-key-1",
    };
    await handleCreateEvent({ ...args });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const second = await handleCreateEvent({ ...args });
    expect(parse(second).idempotent_replay).toBe(true);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces an API failure as an error result", async () => {
    writeSpy.mockRejectedValue(new Error("TeamSnap API error (422): start_date is invalid"));
    const r = await handleCreateEvent({
      team_id: "1", name: "Practice", start_date: "nonsense", preview: false,
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("422");
  });
});

describe("handleUpdateEvent validation", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    writeSpy.mockReset();
  });

  it("requires event_id", async () => {
    await expect(handleUpdateEvent({ patch: { name: "x" } })).rejects.toThrow(/event_id/);
  });

  it("rejects a missing or non-object patch", async () => {
    expect((await handleUpdateEvent({ event_id: "1" })).isError).toBe(true);
    expect((await handleUpdateEvent({ event_id: "1", patch: "name=x" })).isError).toBe(true);
  });

  it("rejects an empty patch", async () => {
    const r = await handleUpdateEvent({ event_id: "1", patch: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("at least one");
  });

  it("rejects unsupported patch keys and names them", async () => {
    const r = await handleUpdateEvent({
      event_id: "1", patch: { name: "ok", team_id: "nope", is_game: true },
    });
    expect(r.isError).toBe(true);
    const t = textOf(r);
    expect(t).toContain("team_id");
    expect(t).toContain("is_game");
  });
});

describe("handleUpdateEvent cancellation gating", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    writeSpy.mockReset();
    writeSpy.mockResolvedValue({ id: 1, name: "Practice", is_canceled: true });
  });

  it("previews a normal patch without warning", async () => {
    const r = await handleUpdateEvent({ event_id: "1", patch: { name: "Renamed" } });
    const p = parse(r);
    expect(p.preview).toBe(true);
    expect(p.would_patch).toBe("events/1");
    expect(p.warning).toBeUndefined();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("warns in preview when the patch cancels the event", async () => {
    const r = await handleUpdateEvent({ event_id: "1", patch: { is_canceled: true } });
    expect(String(parse(r).warning)).toMatch(/notifies the team/i);
  });

  it("blocks an unconfirmed cancellation from reaching the API", async () => {
    const r = await handleUpdateEvent({
      event_id: "1", patch: { is_canceled: true }, preview: false,
    });
    expect(parse(r).blocked).toBeTruthy();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("executes the cancellation once confirm is supplied", async () => {
    const r = await handleUpdateEvent({
      event_id: "1", patch: { is_canceled: true }, preview: false, confirm: true,
    });
    expect(r.isError).toBeFalsy();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [method, endpoint, fields] = writeSpy.mock.calls[0];
    expect(method).toBe("PATCH");
    expect(endpoint).toBe("/events/1");
    expect(fields).toEqual({ is_canceled: true });
  });

  it("does not require confirm for a non-cancelling patch", async () => {
    writeSpy.mockResolvedValue({ id: 1, name: "Renamed" });
    const r = await handleUpdateEvent({
      event_id: "1", patch: { name: "Renamed" }, preview: false,
    });
    expect(parse(r).blocked).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("treats is_canceled:false as a non-destructive patch", async () => {
    writeSpy.mockResolvedValue({ id: 1, is_canceled: false });
    const r = await handleUpdateEvent({
      event_id: "1", patch: { is_canceled: false }, preview: false,
    });
    expect(parse(r).blocked).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("handleDeleteEvent", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    removeSpy.mockReset();
    getEventSpy.mockReset();
    removeSpy.mockResolvedValue(204);
    getEventSpy.mockResolvedValue({
      id: 999, name: "Scratch Event", start_date: "2026-06-01T12:00:00Z",
      team_id: 1001, is_game: false, repeating_type: null,
    });
  });

  // The preview exists so a human can check before authorising a permanent delete.
  // "events/999" alone is not checkable — it cannot distinguish a scratch event from
  // a championship game.
  it("names the event in the preview, not just its id", async () => {
    const p = parse(await handleDeleteEvent({ event_id: "999" }));
    expect(p.event).toMatchObject({
      name: "Scratch Event",
      start_date: "2026-06-01T12:00:00Z",
      team_id: 1001,
    });
  });

  it("warns that a repeating event may take the whole series with it", async () => {
    getEventSpy.mockResolvedValue({ id: 999, name: "Weekly Practice", repeating_type: "weekly" });
    const p = parse(await handleDeleteEvent({ event_id: "999" }));
    expect(String(p.warning)).toMatch(/series/i);
    expect(p.event.repeating_type).toBe("weekly");
  });

  it("still reports what would happen when the event cannot be identified", async () => {
    getEventSpy.mockRejectedValue(new Error("404 Not Found"));
    const p = parse(await handleDeleteEvent({ event_id: "999" }));
    expect(p.preview).toBe(true);
    expect(p.event).toBeNull();
    expect(String(p.unidentified)).toMatch(/could not load/i);
  });

  it("reports the HTTP status of the delete", async () => {
    const p = parse(await handleDeleteEvent({ event_id: "999", preview: false, confirm: true }));
    expect(p.http_status).toBe(204);
  });

  it("requires event_id", async () => {
    await expect(handleDeleteEvent({})).rejects.toThrow(/event_id/);
  });

  it("rejects a non-numeric event_id before deleting anything", async () => {
    for (const bad of ["../teams/1", "9/../../teams/1", "abc"]) {
      const r = await handleDeleteEvent({ event_id: bad, preview: false, confirm: true });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/numeric/i);
    }
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("previews by default and does not delete", async () => {
    const p = parse(await handleDeleteEvent({ event_id: "999" }));
    expect(p.preview).toBe(true);
    expect(p.would_delete).toBe("events/999");
    expect(p.requires_confirm).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("warns that deletion is permanent", async () => {
    const p = parse(await handleDeleteEvent({ event_id: "999" }));
    expect(String(p.warning)).toMatch(/permanent|cannot be undone/i);
  });

  it("blocks an unconfirmed delete", async () => {
    const p = parse(await handleDeleteEvent({ event_id: "999", preview: false }));
    expect(p.blocked).toBeTruthy();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("does not treat confirm alone as permission to execute", async () => {
    const p = parse(await handleDeleteEvent({ event_id: "999", confirm: true }));
    expect(p.preview).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("DELETEs the event once preview:false and confirm are both supplied", async () => {
    const r = await handleDeleteEvent({ event_id: "999", preview: false, confirm: true });
    expect(r.isError).toBeFalsy();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0][0]).toBe("/events/999");
    expect(parse(r)).toMatchObject({ deleted: true, event_id: "999" });
  });

  it("surfaces an API failure as an error result", async () => {
    removeSpy.mockRejectedValue(new Error("TeamSnap API error (404): Not Found"));
    const r = await handleDeleteEvent({ event_id: "999", preview: false, confirm: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("404");
  });
});
