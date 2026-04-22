import { describe, it, expect } from "vitest";
import { TeamSnapClient as LocalClient } from "../src/api/client.js";
import { TeamSnapClient as AwsClient } from "../aws/src/client.js";

describe("parity: local + AWS TeamSnapClient", () => {
  it("expose the same public resource method names", () => {
    const publicMethods = (cls: object) =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(cls))
        .filter((n) => n !== "constructor" && typeof (cls as Record<string, unknown>)[n] === "function")
        .sort();

    const local = new LocalClient();
    // AWS client is async-init; construct and read proto without calling loadCredentials
    const aws = new AwsClient();

    const localNames = publicMethods(local);
    const awsNames = publicMethods(aws);

    const resourceMethods = [
      "getMe",
      "getTeams",
      "getTeam",
      "getTeamMembers",
      "getTeamEvents",
      "getEvent",
      "getAvailabilities",
      "getMemberAvailabilities",
      "getCore",
      "isAuthenticated",
    ];
    for (const m of resourceMethods) {
      expect(localNames).toContain(m);
      expect(awsNames).toContain(m);
    }
  });
});
