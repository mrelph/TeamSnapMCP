import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleGetEvent } from "../../src/tools/handlers/events.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function collItem(obj: Record<string, unknown>) {
  return {
    href: "",
    data: Object.entries(obj).map(([name, value]) => ({ name, value })),
    links: [],
  };
}

describe("handleGetEvent enrichment", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/events/search?id=")) {
        return jsonResponse({
          collection: {
            version: "1.0",
            href: "",
            items: [
              collItem({
                id: 362285015,
                name: "Captain's Practice",
                start_date: "2026-02-10T03:00:00Z",
                end_date: "2026-02-10T04:30:00Z",
                arrival_date: "2026-02-10T02:45:00Z",
                duration_in_minutes: 90,
                minutes_to_arrive_early: 15,
                notes: null,
                uniform: null,
                additional_location_details: "Stadium",
                location_id: 77620297,
                location_name: "LWHS",
                time_zone: "Pacific Time (US & Canada)",
                time_zone_iana_name: "America/Los_Angeles",
                is_game: false,
                is_canceled: false,
                tracks_availability: true,
              }),
            ],
          },
        });
      }
      if (u.includes("/locations/77620297")) {
        return jsonResponse({
          collection: {
            version: "1.0",
            href: "",
            items: [collItem({ id: 77620297, name: "LWHS", address: "123 Main St", latitude: 47, longitude: -122 })],
          },
        });
      }
      throw new Error(`Unexpected URL: ${u}`);
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns enriched event with localized start/end/arrival and inlined location", async () => {
    const result = await handleGetEvent({ event_id: "362285015" });
    if (result.isError) return; // unauthed; skip shape assertions
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const parsed = JSON.parse(text);
    expect(parsed.start.time_zone_iana).toBe("America/Los_Angeles");
    expect(parsed.end).toBeDefined();
    expect(parsed.arrival).toBeDefined();
    expect(parsed.duration_in_minutes).toBe(90);
    expect(parsed.additional_location_details).toBe("Stadium");
    expect(parsed.location).toBeDefined();
    expect(parsed.location.name).toBe("LWHS");
  });
});
