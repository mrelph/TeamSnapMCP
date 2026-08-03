import { describe, it, expect } from "vitest";

// PRE-EXISTING FAILURE ON main — SKIPPED DELIBERATELY, NOT FIXED HERE.
//
// This suite imports ../aws/src/client.js, which transitively imports
// aws/src/dynamodb.ts -> @aws-sdk/client-dynamodb. Those deps are declared in
// aws/package.json, a separate package whose node_modules is never installed at the
// repo root, so the file cannot even be transformed and the whole suite fails to
// load. Verified genuinely pre-existing rather than worktree noise: aws/node_modules
// is absent in the main checkout too, and this reproduces on a clean 29687b6.
//
// Fixing it means either installing aws deps at the root or stubbing the module —
// a build-system change that does not belong in this milestone. Filed as follow-up.
//
// The tool-list <-> dispatch-switch guards that used to live here now run in
// tests/toolWiring.test.ts, which has no aws import and therefore actually executes.
// The assertion body is kept INTACT rather than stubbed to `expect(true)`, so that
// un-skipping this (once aws deps install at the root) restores a real check.
//
// It currently WOULD fail on more than the import: aws/src/client.ts has no
// reloadCredentials(), which every handler calls when isAuthenticated() is false.
// aws/src/lambda.ts still cites "verified by parity test" to justify its cast. That
// is a genuine latent bug in the Lambda transport — filed, not fixed here, because
// aws/ is out of scope for this milestone.
describe.skip("parity: local + AWS TeamSnapClient (pre-existing failure on main)", () => {
  it("expose the same public resource method names", async () => {
    const { TeamSnapClient: LocalClient } = await import("../src/api/client.js");
    const { TeamSnapClient: AwsClient } = await import("../aws/src/client.js");

    const publicMethods = (cls: object) =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(cls))
        .filter((n) => n !== "constructor" && typeof (cls as Record<string, unknown>)[n] === "function")
        .sort();

    const localNames = publicMethods(new LocalClient());
    const awsNames = publicMethods(new AwsClient());

    for (const m of [
      "getMe", "getTeams", "getTeam", "getTeamMembers", "getTeamEvents",
      "getEvent", "getAvailabilities", "getMemberAvailabilities",
      "getCore", "isAuthenticated", "reloadCredentials",
    ]) {
      expect(localNames).toContain(m);
      expect(awsNames).toContain(m);
    }
  });
});
