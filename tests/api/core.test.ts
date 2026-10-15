import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TeamSnapCore } from "../../src/api/core.js";
import type { CollectionResponse } from "../../src/api/types.js";

const originalFetch = globalThis.fetch;

function makeCore(opts: { onRefresh?: () => Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null> } = {}): TeamSnapCore {
  return new TeamSnapCore({
    getCredentials: () => ({
      accessToken: "test-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000,
      clientId: "cid",
      clientSecret: "csec",
    }),
    onRefresh: opts.onRefresh ?? (async () => null),
  });
}

function collectionJSON(items: Array<Record<string, unknown>>): CollectionResponse {
  return {
    collection: {
      version: "1.0",
      href: "https://api.teamsnap.com/v3/teams/search",
      items: items.map((obj) => ({
        href: "https://api.teamsnap.com/v3/teams/1",
        data: Object.entries(obj).map(([name, value]) => ({ name, value })),
        links: [{ rel: "members", href: "https://api.teamsnap.com/v3/members/search?team_id=1" }],
      })),
    },
  };
}

describe("TeamSnapCore.request", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses Collection+JSON items into plain objects preserving _href and _links", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(collectionJSON([{ id: 42, name: "Kraken" }])), { status: 200 })
    );

    const core = makeCore();
    const result = await core.searchMany("/teams/search");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
    expect(result[0].name).toBe("Kraken");
    expect(result[0]._href).toBe("https://api.teamsnap.com/v3/teams/1");
    expect(result[0]._links?.[0]?.rel).toBe("members");
  });

  it("throws when unauthenticated", async () => {
    const core = new TeamSnapCore({
      getCredentials: () => null,
      onRefresh: async () => null,
    });
    await expect(core.searchMany("/teams/search")).rejects.toThrow(/Not authenticated/);
  });

  it("retries once with refreshed token on 401", async () => {
    const onRefresh = vi.fn(async () => ({ accessToken: "new-token", expiresAt: Date.now() + 60_000 }));
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(collectionJSON([{ id: 1 }])), { status: 200 })
      );

    const core = makeCore({ onRefresh });
    const result = await core.searchMany("/teams/search");
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result[0].id).toBe(1);
  });
});

describe("TeamSnapCore.delete", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = originalFetch; });
  it.each([204, 200])("accepts empty %i success and sends a single-occurrence DELETE template", async (status) => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(null, { status }));
    await expect(makeCore().delete("/events/123", { repeating_include: "none", notify_team: false })).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.teamsnap.com/v3/events/123");
    expect(options.method).toBe("DELETE");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ template: { data: [
      { name: "repeating_include", value: "none" }, { name: "notify_team", value: false },
    ] } });
  });
  it.each([403, 404])("preserves structured %i errors", async (status) => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ collection: { error: { title: "Denied", message: "No access" } } }), { status }));
    await expect(makeCore().delete("/events/123", {})).rejects.toThrow(`TeamSnap API error (${status}): Denied: No access`);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
  it("does not retry network failures", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("lost response"));
    await expect(makeCore().delete("/events/123", {})).rejects.toThrow("lost response");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
  it("does not accept empty successful collection reads", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(makeCore().searchMany("/events/search")).rejects.toThrow();
  });
});
