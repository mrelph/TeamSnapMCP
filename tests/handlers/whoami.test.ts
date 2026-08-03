import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleWhoamiMembers } from "../../src/tools/handlers/whoami.js";

const meSpy = vi.fn();
const searchManySpy = vi.fn();
const teamsSpy = vi.fn();
const writeSpy = vi.fn();
const removeSpy = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  teamsnapClient: {
    isAuthenticated: () => true,
    reloadCredentials: () => {},
    getCore: () => ({ searchMany: searchManySpy, write: writeSpy, remove: removeSpy }),
    getMe: (...a: unknown[]) => meSpy(...a),
    getTeams: (...a: unknown[]) => teamsSpy(...a),
  },
}));

function parse(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  return JSON.parse(first.type === "text" ? (first.text ?? "") : "");
}
function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  return first.type === "text" ? (first.text ?? "") : "";
}

describe("handleWhoamiMembers", () => {
  beforeEach(() => {
    meSpy.mockReset();
    searchManySpy.mockReset();
    teamsSpy.mockReset();
    writeSpy.mockReset();
    removeSpy.mockReset();
    meSpy.mockResolvedValue({ id: 7, email: "d@example.com", first_name: "David", last_name: "E" });
    searchManySpy.mockResolvedValue([
      { id: 501, team_id: 1001, first_name: "David", last_name: "E", is_manager: true, is_owner: false, is_commissioner: false },
      { id: 502, team_id: 222, first_name: "David", last_name: "E", is_manager: false, is_owner: false, is_commissioner: false },
    ]);
    teamsSpy.mockResolvedValue([
      { id: 1001, name: "Riverside United" },
      { id: 222, name: "Lakeside Athletic" },
    ]);
  });

  it("looks members up by the authenticated user id, not by team", async () => {
    await handleWhoamiMembers({});
    expect(meSpy).toHaveBeenCalledTimes(1);
    expect(searchManySpy).toHaveBeenCalledTimes(1);
    const url = String(searchManySpy.mock.calls[0][0]);
    expect(url).toContain("/members/search");
    expect(url).toContain("user_id=7");
    expect(url).not.toContain("team_id=");
  });

  it("reports one membership per team with permission flags", async () => {
    const p = parse(await handleWhoamiMembers({}));
    expect(p.membership_count).toBe(2);
    const railers = p.memberships.find((m: { team_id: number }) => m.team_id === 1001);
    expect(railers).toMatchObject({
      team_id: 1001,
      team_name: "Riverside United",
      member_id: 501,
      is_manager: true,
      is_owner: false,
    });
  });

  it("summarises which teams the user manages, always identifiably", async () => {
    const p = parse(await handleWhoamiMembers({}));
    expect(p.manages).toEqual([{ team_id: 1001, team_name: "Riverside United" }]);
  });

  // Regression: `manages` used to map to team_name alone, so when the best-effort
  // name lookup failed it answered [null, null] — nothing, for the one question
  // this tool exists to answer.
  it("still identifies managed teams by id when the name lookup fails", async () => {
    teamsSpy.mockRejectedValue(new Error("teams endpoint down"));
    const p = parse(await handleWhoamiMembers({}));
    expect(p.manages).toEqual([{ team_id: 1001, team_name: null }]);
    expect(p.manages[0].team_id).toBe(1001);
  });

  it("counts teams separately from member records", async () => {
    searchManySpy.mockResolvedValue([
      { id: 1, team_id: 99, is_manager: true },
      { id: 2, team_id: 99, is_manager: false },
    ]);
    const p = parse(await handleWhoamiMembers({}));
    expect(p.membership_count).toBe(2);
    expect(p.team_count).toBe(1);
  });

  it("counts ownership as managing even when is_manager is false", async () => {
    searchManySpy.mockResolvedValue([
      { id: 503, team_id: 222, is_manager: false, is_owner: true },
    ]);
    const p = parse(await handleWhoamiMembers({}));
    expect(p.manages).toEqual([{ team_id: 222, team_name: "Lakeside Athletic" }]);
  });

  it("defaults missing permission flags to false rather than undefined", async () => {
    searchManySpy.mockResolvedValue([{ id: 504, team_id: 222 }]);
    const p = parse(await handleWhoamiMembers({}));
    expect(p.memberships[0]).toMatchObject({
      is_manager: false,
      is_owner: false,
      is_commissioner: false,
    });
  });

  it("still returns memberships when the team-name lookup fails", async () => {
    teamsSpy.mockRejectedValue(new Error("teams endpoint down"));
    const p = parse(await handleWhoamiMembers({}));
    expect(p.membership_count).toBe(2);
    expect(p.memberships[0].team_name).toBeNull();
  });

  it("returns an empty membership list rather than erroring when the user has no teams", async () => {
    searchManySpy.mockResolvedValue([]);
    const p = parse(await handleWhoamiMembers({}));
    expect(p.membership_count).toBe(0);
    expect(p.memberships).toEqual([]);
    expect(p.manages).toEqual([]);
  });

  it("errors when /me does not yield a user id", async () => {
    meSpy.mockResolvedValue({});
    const r = await handleWhoamiMembers({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/user id/i);
  });

  it("surfaces an API failure as an error result", async () => {
    searchManySpy.mockRejectedValue(new Error("TeamSnap API error (401): Unauthorized"));
    const r = await handleWhoamiMembers({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("401");
  });

  // This asserts on the spies the HANDLER would have to call to mutate anything.
  // The earlier version inspected an object literal the test itself built, which
  // proved nothing about the handler at all.
  it("never issues a write or delete — it is a read-only tool", async () => {
    await handleWhoamiMembers({});
    expect(searchManySpy).toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
