import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  server: undefined as import("node:http").Server | undefined,
  loadCredentials: vi.fn(),
  hasCredentials: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, createServer: (...args: Parameters<typeof actual.createServer>) => {
    state.server = actual.createServer(...args);
    return state.server;
  } };
});
vi.mock("../src/utils/storage.js", () => ({
  saveCredentials: vi.fn(), loadCredentials: state.loadCredentials,
  hasCredentials: state.hasCredentials, clearCredentials: vi.fn(),
}));
vi.mock("../src/api/client.js", () => ({
  teamsnapClient: { reloadCredentials: vi.fn(), getMe: state.getMe },
}));

process.env.TEAMSNAP_CALLBACK_PORT = "0";
process.env.TEAMSNAP_READ_ONLY = "true";
const { generateAuthUrl, startOAuthFlow } = await import("../src/auth/oauth.js");
const { handleAuthStatus } = await import("../src/tools/handlers/auth.js");

afterEach(() => {
  state.server?.closeAllConnections();
  state.server?.close();
  vi.clearAllMocks();
});

describe("local read-only authentication", () => {
  it("requests only read access", () => {
    const url = new URL(generateAuthUrl({ clientId: "fixture", clientSecret: "unused" }, "state"));
    expect(url.searchParams.get("scope")).toBe("read");
  });

  it("keeps login pending on an invalid state and never reflects provider errors", async () => {
    const flow = await startOAuthFlow({ clientId: "fixture", clientSecret: "unused" });
    const outcome = flow.waitForCallback().catch((error: Error) => error);
    await new Promise<void>((resolve) => state.server!.once("listening", resolve));
    const address = state.server!.address() as import("node:net").AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    const callback = new URL(`http://127.0.0.1:${address.port}/callback`);
    callback.searchParams.set("state", "wrong");
    callback.searchParams.set("error", "<script>untrusted</script>");
    const invalid = await fetch(callback);
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("<script>");
    expect(state.server!.listening).toBe(true);
    callback.searchParams.set("state", new URL(flow.authUrl).searchParams.get("state")!);
    const denied = await fetch(callback);
    expect(denied.headers.get("content-type")).toContain("text/plain");
    expect(await denied.text()).not.toContain("<script>");
    expect((await outcome as Error).message).toBe("OAuth authorization was not completed");
  });

  it("does not claim authenticated when stored credentials fail a live read", async () => {
    state.hasCredentials.mockReturnValue(true);
    state.loadCredentials.mockReturnValue({ accessToken: "fixture-only", teamsnapEmail: "fixture@example.invalid" });
    state.getMe.mockRejectedValue(new Error("unavailable"));
    const result = await handleAuthStatus();
    const content = result.content[0];
    expect(content.type).toBe("text");
    const data = JSON.parse((content as { text: string }).text);
    expect(data.authenticated).toBeNull();
    expect(data.credentialPresent).toBe(true);
  });
});
