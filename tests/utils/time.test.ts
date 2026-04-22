import { describe, it, expect } from "vitest";
import { localizeTime, localizeEventTimes } from "../../src/utils/time.js";

describe("localizeTime", () => {
  it("returns null when utcISO is null", () => {
    expect(localizeTime(null, "America/Los_Angeles", "Pacific Time")).toBeNull();
  });

  it("formats in event TZ when no viewerTZ given", () => {
    const out = localizeTime("2026-02-14T03:00:00Z", "America/Los_Angeles", "Pacific Time (US & Canada)");
    expect(out?.utc).toBe("2026-02-14T03:00:00Z");
    expect(out?.time_zone_iana).toBe("America/Los_Angeles");
    expect(out?.time_zone).toBe("Pacific Time (US & Canada)");
    expect(out?.local).toMatch(/PST|PDT/);
    expect(out?.local).toContain("7:00");
    expect(out?.viewer).toBeUndefined();
  });

  it("omits viewer field when viewerTZ equals eventTZ", () => {
    const out = localizeTime("2026-02-14T03:00:00Z", "America/Los_Angeles", "Pacific Time", { viewerTZ: "America/Los_Angeles" });
    expect(out?.viewer).toBeUndefined();
  });

  it("includes viewer field when viewerTZ differs from eventTZ", () => {
    const out = localizeTime("2026-06-14T19:00:00Z", "America/Phoenix", "Arizona", { viewerTZ: "America/Los_Angeles" });
    expect(out?.local).toMatch(/MST/);
    expect(out?.local).toContain("12:00");
    expect(out?.viewer).toBeDefined();
    expect(out?.viewer).toMatch(/PDT|PST/);
  });

  it("falls back to UTC when eventTZ is null", () => {
    const out = localizeTime("2026-02-14T03:00:00Z", null, null);
    expect(out?.time_zone_iana).toBe("UTC");
    expect(out?.time_zone).toBe("UTC");
  });

  it("handles DST correctly (Mar/Nov transitions in LA)", () => {
    const beforeDST = localizeTime("2026-03-08T09:00:00Z", "America/Los_Angeles", "Pacific");
    expect(beforeDST?.local).toMatch(/PST/);
    const afterDST = localizeTime("2026-03-08T11:00:00Z", "America/Los_Angeles", "Pacific");
    expect(afterDST?.local).toMatch(/PDT/);
  });
});

describe("localizeEventTimes", () => {
  it("adds start/end/arrival to an event using event's own IANA name", () => {
    const event = {
      start_date: "2026-02-14T03:00:00Z",
      end_date: "2026-02-14T05:00:00Z",
      arrival_date: "2026-02-14T02:45:00Z",
      time_zone_iana_name: "America/Los_Angeles",
      time_zone: "Pacific Time (US & Canada)",
    };
    const enriched = localizeEventTimes(event);
    expect(enriched.start?.local).toMatch(/PST|PDT/);
    expect(enriched.end?.local).toMatch(/PST|PDT/);
    expect(enriched.arrival?.local).toMatch(/PST|PDT/);
    expect(enriched.start_date).toBe(event.start_date);
  });

  it("returns null fields for missing dates", () => {
    const event = {
      start_date: "2026-02-14T03:00:00Z",
      end_date: null,
      arrival_date: undefined,
      time_zone_iana_name: "America/Los_Angeles",
      time_zone: "Pacific Time",
    };
    const enriched = localizeEventTimes(event);
    expect(enriched.start).not.toBeNull();
    expect(enriched.end).toBeNull();
    expect(enriched.arrival).toBeNull();
  });
});
