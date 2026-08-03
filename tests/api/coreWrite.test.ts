import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TeamSnapCore } from "../../src/api/core.js";

// TeamSnapCore.write is the HTTP layer every write tool funnels through, and it had
// no coverage — tests/api/core.test.ts exercises only the read path, and the handler
// suites stub `write` out entirely.

const originalFetch = globalThis.fetch;

function makeCore(onRefresh = async () => null) {
  return new TeamSnapCore({
    getCredentials: () => ({
      accessToken: "tok",
      clientId: "cid",
      clientSecret: "secret",
    }),
    onRefresh,
  });
}

function collection(items: Array<Record<string, unknown>>, status = 200) {
  return new Response(
    JSON.stringify({
      collection: {
        version: "1.0",
        href: "",
        items: items.map((obj) => ({
          href: "",
          data: Object.entries(obj).map(([name, value]) => ({ name, value })),
          links: [],
        })),
      },
    }),
    { status }
  );
}

describe("TeamSnapCore.write", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a Collection+JSON template with the right method, URL and headers", async () => {
    const fetchSpy = vi.fn(async () => collection([{ id: 1, is_manager: true }]));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    await makeCore().write("PATCH", "/members/42", { is_manager: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.teamsnap.com/v3/members/42");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({
      template: { data: [{ name: "is_manager", value: true }] },
    });
  });

  it("preserves false and 0 in the template rather than dropping them", async () => {
    const fetchSpy = vi.fn(async () => collection([{ id: 1 }]));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    await makeCore().write("PATCH", "/members/42", { is_manager: false, count: 0 });

    const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.template.data).toEqual([
      { name: "is_manager", value: false },
      { name: "count", value: 0 },
    ]);
  });

  it("parses the returned item into a flat object", async () => {
    globalThis.fetch = vi.fn(async () =>
      collection([{ id: 42, is_manager: true, is_owner: false }])
    ) as unknown as typeof globalThis.fetch;

    const result = await makeCore().write("PATCH", "/members/42", { is_manager: true });
    expect(result).toMatchObject({ id: 42, is_manager: true, is_owner: false });
  });

  it("throws when the write succeeds but returns no item", async () => {
    globalThis.fetch = vi.fn(async () => collection([])) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(
      /returned no item/
    );
  });

  it("surfaces a Collection+JSON error body with title and message", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ collection: { error: { title: "Forbidden", message: "not a manager" } } }),
          { status: 403 }
        )
    ) as unknown as typeof globalThis.fetch;

    await expect(makeCore().write("PATCH", "/members/42", { is_owner: true })).rejects.toThrow(
      /403.*Forbidden: not a manager/
    );
  });

  it("retries a write once after refreshing on 401, and does not loop", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      return calls === 1 ? collection([], 401) : collection([{ id: 42 }]);
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const onRefresh = vi.fn(async () => ({ accessToken: "tok2" }));

    const result = await makeCore(onRefresh).write("PATCH", "/members/42", { is_manager: true });
    expect(result).toMatchObject({ id: 42 });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports reauthentication_required when the refresh fails", async () => {
    globalThis.fetch = vi.fn(async () => collection([], 401)) as unknown as typeof globalThis.fetch;
    await expect(
      makeCore(async () => null).write("PATCH", "/members/42", { is_manager: true })
    ).rejects.toThrow(/reauthentication_required/);
  });

  it("refuses to write when there is no access token", async () => {
    const core = new TeamSnapCore({
      getCredentials: () => null,
      onRefresh: async () => null,
    });
    await expect(core.write("POST", "/events", { name: "x" })).rejects.toThrow(/Not authenticated/);
  });
});

// The 204/empty-body behaviour this branch added to the HTTP layer. Previously pinned
// by nothing: eventWrites.test.ts stubs remove() out entirely.
describe("TeamSnapCore.remove", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("issues DELETE to the given endpoint", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    await makeCore().remove("/events/999");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.teamsnap.com/v3/events/999");
    expect(init.method).toBe("DELETE");
  });

  it("resolves on 204 No Content rather than failing to parse an empty body", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;
    await expect(makeCore().remove("/events/999")).resolves.toBe(204);
  });

  it("resolves on an empty 200 body", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(makeCore().remove("/events/999")).resolves.toBe(200);
  });

  it("rejects on 404 with the API error detail", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ collection: { error: { title: "Not Found", message: "no such event" } } }), { status: 404 })
    ) as unknown as typeof globalThis.fetch;
    await expect(makeCore().remove("/events/999")).rejects.toThrow(/404.*Not Found: no such event/);
  });

  it("retries once after refreshing on 401", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 401 }) : new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    const onRefresh = vi.fn(async () => ({ accessToken: "tok2" }));
    await expect(makeCore(onRefresh).remove("/events/999")).resolves.toBe(204);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("reports reauthentication_required when the refresh fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof globalThis.fetch;
    await expect(makeCore(async () => null).remove("/events/999")).rejects.toThrow(/reauthentication_required/);
  });

  it("refuses to delete when there is no access token", async () => {
    const core = new TeamSnapCore({ getCredentials: () => null, onRefresh: async () => null });
    await expect(core.remove("/events/999")).rejects.toThrow(/Not authenticated/);
  });
});

describe("TeamSnapCore.request empty-body handling", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // request() is typed Promise<T>; returning `undefined as T` for a bodiless 2xx
  // would fault later on `.collection` with no compile-time signal. Name it instead.
  it("throws a named error, not a parse error, when a 2xx carries no body", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("PATCH", "/events/1", { name: "x" })).rejects.toThrow(
      /empty body for \/events\/1 \(status 200\)/
    );
  });

  it("says the request succeeded so a caller does not blindly retry a landed write", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(/succeeded/i);
  });
});

// Reproduced against the LIVE API on 2026-08-03: a token issued before write support
// gets 403 "...provided the appropriate scopes..." on a write. That is not a 401, so
// it never reaches refresh-and-retry — and a refresh would not help, since it
// preserves the original scope. The caller must be told to re-consent.
describe("scope failures on writes are actionable", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const scope403 = () =>
    new Response(
      JSON.stringify({
        collection: {
          error: {
            title: "Forbidden",
            message:
              "You are not authorized to view this resource. Please ensure that you have the correct permissions and that you have provided the appropriate scopes to view this resource.",
          },
        },
      }),
      { status: 403 }
    );

  it("tells the caller to re-run teamsnap_auth when a POST is refused for scope", async () => {
    globalThis.fetch = vi.fn(scope403) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(
      /reauthentication_required/
    );
  });

  it("names teamsnap_auth and read write explicitly", async () => {
    globalThis.fetch = vi.fn(scope403) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(/teamsnap_auth/);
    globalThis.fetch = vi.fn(scope403) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(/read write/);
  });

  it("applies to DELETE too", async () => {
    globalThis.fetch = vi.fn(scope403) as unknown as typeof globalThis.fetch;
    await expect(makeCore().remove("/events/1")).rejects.toThrow(/reauthentication_required/);
  });

  it("preserves TeamSnap's own wording for diagnosis", async () => {
    globalThis.fetch = vi.fn(scope403) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(
      /appropriate scopes/
    );
  });

  it("does NOT hijack an ordinary 403 that is about permissions, not scope", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ collection: { error: { title: "Forbidden", message: "not a manager of this team" } } }), { status: 403 })
    ) as unknown as typeof globalThis.fetch;
    await expect(makeCore().write("POST", "/events", { name: "x" })).rejects.toThrow(
      /TeamSnap API error \(403\): Forbidden: not a manager/
    );
  });

  it("does NOT change read failures", async () => {
    globalThis.fetch = vi.fn(scope403) as unknown as typeof globalThis.fetch;
    await expect(makeCore().searchMany("/events/search?team_id=1")).rejects.toThrow(
      /TeamSnap API error \(403\)/
    );
  });
});
