import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredCredentials } from "../src/utils/storage.js";

const state = vi.hoisted(() => ({ loadCredentials: vi.fn<() => StoredCredentials | null>(() => null) }));
vi.mock("../src/utils/storage.js", () => ({
  loadCredentials: state.loadCredentials,
  saveCredentials: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  state.loadCredentials.mockReturnValue(null);
  vi.resetModules();
});

describe("singleton credential reload", () => {
  it("uses credentials saved after the server starts for authenticated API reads", async () => {
    const { teamsnapClient } = await import("../src/api/client.js");
    expect(teamsnapClient.isAuthenticated()).toBe(false);
    state.loadCredentials.mockReturnValue({
      accessToken: "fixture-only", clientId: "fixture", clientSecret: "fixture",
    });
    const request = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.headers).toMatchObject({ Authorization: "Bearer fixture-only" });
      return new Response(JSON.stringify({ collection: { items: [
        { href: "https://api.teamsnap.com/v3/me", data: [{ name: "id", value: 7 }], links: [] },
      ] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    teamsnapClient.reloadCredentials();
    expect(teamsnapClient.isAuthenticated()).toBe(true);
    expect((await teamsnapClient.getMe()).id).toBe(7);
    expect(request).toHaveBeenCalledOnce();
  });
});
