import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildTemplate,
  checkIdempotency,
  storeIdempotency,
  requireConfirm,
  idempotencyScope,
  __clearIdempotencyCache,
  __idempotencyCacheSize,
} from "../src/utils/writeSafety.js";

const SCOPE = idempotencyScope("tool_a", "42", { is_manager: true });

describe("buildTemplate", () => {
  it("produces Collection+JSON template from flat fields", () => {
    const t = buildTemplate({ subject: "Hi", body: "There", recipient_count: 5 });
    expect(t).toEqual({
      template: {
        data: [
          { name: "subject", value: "Hi" },
          { name: "body", value: "There" },
          { name: "recipient_count", value: 5 },
        ],
      },
    });
  });

  it("omits fields whose value is undefined", () => {
    const t = buildTemplate({ a: "x", b: undefined, c: null });
    expect(t.template.data).toEqual([
      { name: "a", value: "x" },
      { name: "c", value: null },
    ]);
  });

  it("preserves false, 0, and empty string", () => {
    const t = buildTemplate({ flag: false, count: 0, note: "" });
    expect(t.template.data).toEqual([
      { name: "flag", value: false },
      { name: "count", value: 0 },
      { name: "note", value: "" },
    ]);
  });
});

describe("idempotency cache", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for unknown key", () => {
    expect(checkIdempotency(SCOPE, "key-a")).toBeNull();
  });

  it("returns null when key is undefined", () => {
    expect(checkIdempotency(SCOPE, undefined)).toBeNull();
  });

  it("returns stored value within TTL", () => {
    storeIdempotency(SCOPE, "key-a", { ok: true });
    expect(checkIdempotency(SCOPE, "key-a")).toEqual({ ok: true });
  });

  it("expires after 60 seconds", () => {
    storeIdempotency(SCOPE, "key-a", { ok: true });
    vi.advanceTimersByTime(59_000);
    expect(checkIdempotency(SCOPE, "key-a")).toEqual({ ok: true });
    vi.advanceTimersByTime(2_000);
    expect(checkIdempotency(SCOPE, "key-a")).toBeNull();
  });

  it("storeIdempotency is a no-op when key is undefined", () => {
    storeIdempotency(SCOPE, undefined, { ok: true });
    expect(checkIdempotency(SCOPE, undefined)).toBeNull();
  });
});

describe("requireConfirm", () => {
  it("returns ok=true when confirm is true", () => {
    expect(requireConfirm({ confirm: true })).toEqual({ ok: true });
  });

  it("returns ok=false with reason when confirm is missing", () => {
    const r = requireConfirm({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("confirm: true");
  });

  it("returns ok=false when confirm is false", () => {
    const r = requireConfirm({ confirm: false });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when confirm is a non-boolean truthy value", () => {
    const r = requireConfirm({ confirm: "yes" });
    expect(r.ok).toBe(false);
  });
});

describe("idempotency scoping", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
  });

  // Regression: the cache used to be keyed on the caller-supplied string alone.
  // Keys are model-generated and collide readily ("1", "retry"), so a reused key
  // replayed an unrelated result and reported success for a write that never ran.
  it("does not replay across different target resources", () => {
    const forMember42 = idempotencyScope("teamsnap_update_member_permissions", "42", { is_manager: true });
    const forMember99 = idempotencyScope("teamsnap_update_member_permissions", "99", { is_manager: true });
    storeIdempotency(forMember42, "shared-key", { id: 42 });
    expect(checkIdempotency(forMember99, "shared-key")).toBeNull();
    expect(checkIdempotency(forMember42, "shared-key")).toEqual({ id: 42 });
  });

  it("does not replay across different tools", () => {
    const createEvent = idempotencyScope("teamsnap_create_event", "10", { name: "x" });
    const sendMessage = idempotencyScope("teamsnap_send_team_message", "10", { name: "x" });
    storeIdempotency(createEvent, "k", { id: 1 });
    expect(checkIdempotency(sendMessage, "k")).toBeNull();
  });

  it("does not replay when the same key is reused with a different payload", () => {
    const grant = idempotencyScope("teamsnap_update_member_permissions", "42", { is_manager: true });
    const revoke = idempotencyScope("teamsnap_update_member_permissions", "42", { is_manager: false });
    storeIdempotency(grant, "k", { is_manager: true });
    expect(checkIdempotency(revoke, "k")).toBeNull();
  });

  it("does replay a genuine retry — same tool, target and payload", () => {
    const a = idempotencyScope("teamsnap_create_event", "10", { name: "Practice", is_game: false });
    const b = idempotencyScope("teamsnap_create_event", "10", { name: "Practice", is_game: false });
    storeIdempotency(a, "k", { id: 7 });
    expect(checkIdempotency(b, "k")).toEqual({ id: 7 });
  });

  it("fingerprints payloads independently of key order", () => {
    const a = idempotencyScope("t", "1", { is_manager: true, is_owner: false });
    const b = idempotencyScope("t", "1", { is_owner: false, is_manager: true });
    expect(a).toBe(b);
  });

  it("bounds cache growth rather than accumulating an entry per key forever", () => {
    for (let i = 0; i < 600; i++) {
      storeIdempotency(idempotencyScope("t", String(i), {}), `k${i}`, { i });
    }
    expect(__idempotencyCacheSize()).toBeLessThanOrEqual(500);
  });
});
