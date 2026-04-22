import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildTemplate,
  checkIdempotency,
  storeIdempotency,
  requireConfirm,
  __clearIdempotencyCache,
} from "../src/utils/writeSafety.js";

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
    expect(checkIdempotency("key-a")).toBeNull();
  });

  it("returns null when key is undefined", () => {
    expect(checkIdempotency(undefined)).toBeNull();
  });

  it("returns stored value within TTL", () => {
    storeIdempotency("key-a", { ok: true });
    expect(checkIdempotency("key-a")).toEqual({ ok: true });
  });

  it("expires after 60 seconds", () => {
    storeIdempotency("key-a", { ok: true });
    vi.advanceTimersByTime(59_000);
    expect(checkIdempotency("key-a")).toEqual({ ok: true });
    vi.advanceTimersByTime(2_000);
    expect(checkIdempotency("key-a")).toBeNull();
  });

  it("storeIdempotency is a no-op when key is undefined", () => {
    storeIdempotency(undefined, { ok: true });
    expect(checkIdempotency(undefined)).toBeNull();
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
