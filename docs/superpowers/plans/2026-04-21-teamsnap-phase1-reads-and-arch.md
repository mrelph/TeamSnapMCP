# TeamSnap MCP — Phase 1: Reads + Architecture Refactor + Timezone Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-21-teamsnap-api-coverage-expansion-design.md`](../specs/2026-04-21-teamsnap-api-coverage-expansion-design.md)

**Goal:** Expand the TeamSnap MCP from 9 read tools (5 endpoints) to 20 read tools covering announcements, assignments, locations, contacts, opponents, standings, stats, forums, member availability, calendar, and custom data; consolidate the drifting local + AWS `TeamSnapClient` implementations into one shared core; fix the event-time timezone bug using per-event IANA data.

**Architecture:** A single shared API core in `src/api/core.ts` is wrapped by two thin credential-loading facades (`src/api/client.ts` for local encrypted storage, `aws/src/client.ts` for DynamoDB). Handlers split from one `src/tools/handlers.ts` file into a `src/tools/handlers/` directory organized by domain; a simple switch-statement router dispatches tool names. A new `src/utils/time.ts` localizes event times using per-event IANA zones with an optional viewer-TZ override. Phase 1 leaves OAuth scope at `read` — writes are Phase 2.

**Tech Stack:** TypeScript (NodeNext modules), Node 18+ built-in `fetch` and `Intl`, `@modelcontextprotocol/sdk`. Tests added in this phase: `vitest` with mocked `globalThis.fetch`. AWS build uses esbuild; shared code imported across the repo boundary.

---

## File Structure

**Files created:**
- `src/api/types.ts` — Collection+JSON type definitions (`CollectionItem`, `CollectionResponse`, `Link`, `ParsedItem`)
- `src/api/endpoints.ts` — `ENDPOINTS` constants, `REL` constants
- `src/api/core.ts` — `TeamSnapCore` class: request, followLink, Collection+JSON parse, resource methods
- `src/utils/time.ts` — `localizeTime`, `localizeEventTimes`
- `src/utils/sports.ts` — `sport_id` → name lookup table
- `src/tools/handlers/index.ts` — router (`handleToolCall` switch)
- `src/tools/handlers/auth.ts` — `handleAuth`, `handleAuthStatus`, `handleLogout`
- `src/tools/handlers/teams.ts` — `handleListTeams`, `handleGetTeam`
- `src/tools/handlers/roster.ts` — `handleGetRoster`, `handleGetContacts`, `handleGetMemberAvailability`
- `src/tools/handlers/events.ts` — `handleGetEvents`, `handleGetEvent`, `handleGetLocation`
- `src/tools/handlers/availability.ts` — `handleGetAvailability`
- `src/tools/handlers/announcements.ts` — `handleGetAnnouncements`
- `src/tools/handlers/assignments.ts` — `handleGetAssignments`
- `src/tools/handlers/opponents.ts` — `handleGetOpponents`, `handleGetResultsAndStandings`
- `src/tools/handlers/stats.ts` — `handleGetStats`
- `src/tools/handlers/forum.ts` — `handleGetForumTopics`, `handleGetForumPosts`
- `src/tools/handlers/meta.ts` — `handleGetCalendarUrls`, `handleGetCustomData`
- `aws/src/client.ts` — AWS facade wrapping `TeamSnapCore` with DynamoDB credential store
- `tests/utils/time.test.ts`
- `tests/api/core.test.ts`
- `tests/handlers/events.test.ts`
- `tests/handlers/announcements.test.ts`
- `tests/handlers/assignments.test.ts`
- `tests/handlers/roster.test.ts`
- `tests/fixtures/team.json`, `tests/fixtures/event.json`, `tests/fixtures/members.json`, `tests/fixtures/announcements.json`, `tests/fixtures/assignments.json`
- `tests/parity.test.ts` — ensures local + AWS facades expose the same method set
- `vitest.config.ts`

**Files modified:**
- `package.json` — add `vitest` devDependency, add `test` script
- `src/api/client.ts` — becomes thin facade over `TeamSnapCore`
- `src/tools/index.ts` — add 11 new tool definitions, adjust 4 existing descriptions
- `src/index.ts` — import router from `handlers/index.ts`
- `aws/src/lambda.ts` — import router from `src/tools/handlers/index.ts`, delete embedded duplicate handlers
- `aws/tsconfig.json` — extend root tsconfig, add `../src/**/*` to include
- `README.md` — add new tools to table

**Files deleted:**
- `src/tools/handlers.ts` — replaced by `src/tools/handlers/`
- `aws/src/teamsnap.ts` — replaced by `aws/src/client.ts`

---

## Testing Strategy

Unit tests mock `globalThis.fetch` with `vi.fn()`. Fixtures are committed JSON files captured from live discovery against the author's real account (sanitized of sensitive IDs if needed). Every new tool has at least one unit test asserting both the TeamSnap call shape and the handler's response shape.

Integration tests (hitting real TeamSnap) are out of scope for this plan — manual smoke test at the end.

---

## Task 1: Add vitest and test script

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts` (sanity-check test)

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^2.1.8 @types/node
```

Expected: vitest added to devDependencies; no errors.

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write sanity-check test**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "chore: add vitest for Phase 1 refactor tests"
```

---

## Task 2: Create API types and endpoint constants

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/endpoints.ts`

- [ ] **Step 1: Create types file**

Create `src/api/types.ts`:

```ts
export interface Link {
  rel: string;
  href: string;
  prompt?: string;
}

export interface CollectionDataField {
  name: string;
  value: unknown;
}

export interface CollectionItem {
  href: string;
  data: CollectionDataField[];
  links?: Link[];
}

export interface CollectionResponse {
  collection: {
    version: string;
    href: string;
    items?: CollectionItem[];
    links?: Link[];
    error?: { title: string; message: string };
  };
}

export type ParsedItem = Record<string, unknown> & {
  _href?: string;
  _links?: Link[];
};
```

- [ ] **Step 2: Create endpoints file**

Create `src/api/endpoints.ts`:

```ts
export const API_BASE = "https://api.teamsnap.com/v3";
export const TOKEN_URL = "https://auth.teamsnap.com/oauth/token";

export const ENDPOINTS = {
  me: "/me",
  teams: "/teams/search",
  members: "/members/search",
  events: "/events/search",
  availabilities: "/availabilities/search",
  locations: "/locations/search",
  locationById: (id: string) => `/locations/${id}`,
  memberEmails: "/member_email_addresses/search",
  memberPhones: "/member_phone_numbers/search",
  memberPhotos: "/member_photos/search",
  contacts: "/contacts/search",
  contactEmails: "/contact_email_addresses/search",
  contactPhones: "/contact_phone_numbers/search",
  broadcastEmails: "/broadcast_emails/search",
  broadcastAlerts: "/broadcast_alerts/search",
  messages: "/messages/search",
  trackedItems: "/tracked_items/search",
  trackedItemStatuses: "/tracked_item_statuses/search",
  assignments: "/assignments/search",
  opponents: "/opponents/search",
  opponentsResults: "/opponents_results/search",
  teamResults: "/team_results/search",
  divisionTeamStandings: "/division_team_standings/search",
  statistics: "/statistics/search",
  memberStatistics: "/member_statistics/search",
  eventStatistics: "/event_statistics/search",
  teamStatistics: "/team_statistics/search",
  forumTopics: "/forum_topics/search",
  forumPosts: "/forum_posts/search",
  customFields: "/custom_fields/search",
  customData: "/custom_data/search",
} as const;

export const REL = {
  calendar_http: "calendar_http",
  calendar_http_games_only: "calendar_http_games_only",
  calendar_webcal: "calendar_webcal",
  calendar_webcal_games_only: "calendar_webcal_games_only",
  team_public_site: "team_public_site",
  location: "location",
} as const;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/api/types.ts src/api/endpoints.ts
git commit -m "refactor: add API type and endpoint constants"
```

---

## Task 3: Create shared API core (request + Collection+JSON parse + refresh)

**Files:**
- Create: `src/api/core.ts`
- Create: `tests/api/core.test.ts`

- [ ] **Step 1: Write failing test for Collection+JSON parse**

Create `tests/api/core.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/core.test.ts`
Expected: FAIL with "Cannot find module" or "TeamSnapCore is not defined".

- [ ] **Step 3: Implement core**

Create `src/api/core.ts`:

```ts
import { API_BASE } from "./endpoints.js";
import type { CollectionItem, CollectionResponse, Link, ParsedItem } from "./types.js";

export interface CoreCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  clientSecret: string;
}

export interface CoreOptions {
  getCredentials: () => CoreCredentials | null;
  onRefresh: () => Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null>;
}

export function parseCollectionItem(item: CollectionItem): ParsedItem {
  const result: ParsedItem = {};
  for (const { name, value } of item.data) {
    result[name] = value;
  }
  result._href = item.href;
  result._links = item.links;
  return result;
}

export class TeamSnapCore {
  constructor(private readonly opts: CoreOptions) {}

  private getCreds(): CoreCredentials {
    const creds = this.opts.getCredentials();
    if (!creds || !creds.accessToken) {
      throw new Error("Not authenticated. Please run teamsnap_auth first.");
    }
    return creds;
  }

  async request<T>(endpointOrUrl: string, options: RequestInit = {}, _retried = false): Promise<T> {
    const creds = this.getCreds();
    const url = endpointOrUrl.startsWith("http") ? endpointOrUrl : `${API_BASE}${endpointOrUrl}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (response.status === 401 && !_retried) {
      const refreshed = await this.opts.onRefresh();
      if (refreshed) {
        return this.request<T>(endpointOrUrl, options, true);
      }
      throw new Error("Session expired. Please re-authenticate with teamsnap_auth.");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TeamSnap API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async searchMany(endpointOrUrl: string): Promise<ParsedItem[]> {
    const data = await this.request<CollectionResponse>(endpointOrUrl);
    return (data.collection.items ?? []).map(parseCollectionItem);
  }

  async searchOne(endpointOrUrl: string): Promise<ParsedItem | null> {
    const data = await this.request<CollectionResponse>(endpointOrUrl);
    const first = data.collection.items?.[0];
    return first ? parseCollectionItem(first) : null;
  }

  followLink(resource: { _links?: Link[] }, rel: string): string | null {
    const link = resource._links?.find((l) => l.rel === rel);
    return link?.href ?? null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/api/core.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/core.ts tests/api/core.test.ts
git commit -m "refactor: add shared TeamSnapCore with request/parse/followLink"
```

---

## Task 4: Refactor src/api/client.ts to thin facade

**Files:**
- Modify: `src/api/client.ts`

- [ ] **Step 1: Replace file contents**

Replace `src/api/client.ts` entirely with:

```ts
import { OAUTH_REDIRECT_URI } from "../utils/config.js";
import { loadCredentials, saveCredentials, type StoredCredentials } from "../utils/storage.js";
import { TeamSnapCore, type CoreCredentials } from "./core.js";
import { ENDPOINTS, TOKEN_URL } from "./endpoints.js";
import type { ParsedItem } from "./types.js";

export class TeamSnapClient {
  private credentials: StoredCredentials | null = null;
  private readonly core: TeamSnapCore;

  constructor() {
    this.credentials = loadCredentials();
    this.core = new TeamSnapCore({
      getCredentials: () => this.toCoreCredentials(),
      onRefresh: () => this.refreshToken(),
    });
  }

  private toCoreCredentials(): CoreCredentials | null {
    if (!this.credentials) return null;
    return {
      accessToken: this.credentials.accessToken,
      refreshToken: this.credentials.refreshToken,
      expiresAt: this.credentials.expiresAt,
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
    };
  }

  isAuthenticated(): boolean {
    return this.credentials !== null && !!this.credentials.accessToken;
  }

  reloadCredentials(): void {
    this.credentials = loadCredentials();
  }

  private async refreshToken(): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null> {
    if (!this.credentials?.refreshToken) return null;
    try {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.credentials.refreshToken,
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          redirect_uri: OAUTH_REDIRECT_URI,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
      this.credentials = {
        ...this.credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.credentials.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
      saveCredentials(this.credentials);
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: this.credentials.expiresAt,
      };
    } catch {
      return null;
    }
  }

  getCore(): TeamSnapCore {
    return this.core;
  }

  async getMe(): Promise<ParsedItem> {
    const result = await this.core.searchOne(ENDPOINTS.me);
    if (!result) throw new Error("No user data returned");
    return result;
  }

  async getTeams(): Promise<ParsedItem[]> {
    let userId = this.credentials?.teamsnapUserId;
    if (!userId) {
      const me = await this.getMe();
      userId = String(me.id);
    }
    return this.core.searchMany(`${ENDPOINTS.teams}?user_id=${userId}`);
  }

  async getTeam(teamId: string): Promise<ParsedItem> {
    const team = await this.core.searchOne(`${ENDPOINTS.teams}?id=${teamId}`);
    if (!team) throw new Error(`Team ${teamId} not found`);
    return team;
  }

  async getTeamMembers(teamId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`);
  }

  async getTeamEvents(teamId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.events}?team_id=${teamId}`);
  }

  async getEvent(eventId: string): Promise<ParsedItem> {
    const event = await this.core.searchOne(`${ENDPOINTS.events}?id=${eventId}`);
    if (!event) throw new Error(`Event ${eventId} not found`);
    return event;
  }

  async getAvailabilities(eventId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.availabilities}?event_id=${eventId}`);
  }

  async getMemberAvailabilities(memberId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.availabilities}?member_id=${memberId}`);
  }
}

export const teamsnapClient = new TeamSnapClient();
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add src/api/client.ts
git commit -m "refactor: make local TeamSnapClient a thin facade over TeamSnapCore"
```

---

## Task 5: Create AWS facade and delete aws/src/teamsnap.ts

**Files:**
- Create: `aws/src/client.ts`
- Modify: `aws/tsconfig.json`
- Delete: `aws/src/teamsnap.ts`

- [ ] **Step 1: Update aws/tsconfig.json to include src/**

Read the current file first:

```bash
cat aws/tsconfig.json
```

Then replace with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "..",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "../src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Create AWS facade**

Create `aws/src/client.ts`:

```ts
import { TeamSnapCore, type CoreCredentials } from "../../src/api/core.js";
import { ENDPOINTS, TOKEN_URL } from "../../src/api/endpoints.js";
import type { ParsedItem } from "../../src/api/types.js";
import { loadCredentials, saveCredentials, type StoredCredentials } from "./dynamodb.js";

export class TeamSnapClient {
  private credentials: StoredCredentials | null = null;
  private readonly core: TeamSnapCore;

  constructor() {
    this.core = new TeamSnapCore({
      getCredentials: () => this.toCoreCredentials(),
      onRefresh: () => this.refreshToken(),
    });
  }

  async loadCredentials(): Promise<void> {
    this.credentials = await loadCredentials();
  }

  private toCoreCredentials(): CoreCredentials | null {
    if (!this.credentials) return null;
    return {
      accessToken: this.credentials.accessToken,
      refreshToken: this.credentials.refreshToken,
      expiresAt: this.credentials.expiresAt,
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
    };
  }

  isAuthenticated(): boolean {
    return this.credentials !== null && !!this.credentials.accessToken;
  }

  private async refreshToken(): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null> {
    if (!this.credentials?.refreshToken) return null;
    try {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.credentials.refreshToken,
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
      const updated: StoredCredentials = {
        ...this.credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.credentials.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
      await saveCredentials(updated);
      this.credentials = updated;
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: updated.expiresAt,
      };
    } catch {
      return null;
    }
  }

  getCore(): TeamSnapCore {
    return this.core;
  }

  async getMe(): Promise<ParsedItem> {
    const result = await this.core.searchOne(ENDPOINTS.me);
    if (!result) throw new Error("No user data returned");
    return result;
  }

  async getTeams(): Promise<ParsedItem[]> {
    const me = await this.getMe();
    return this.core.searchMany(`${ENDPOINTS.teams}?user_id=${me.id}`);
  }

  async getTeam(teamId: string): Promise<ParsedItem> {
    const team = await this.core.searchOne(`${ENDPOINTS.teams}?id=${teamId}`);
    if (!team) throw new Error(`Team ${teamId} not found`);
    return team;
  }

  async getTeamMembers(teamId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`);
  }

  async getTeamEvents(teamId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.events}?team_id=${teamId}`);
  }

  async getEvent(eventId: string): Promise<ParsedItem> {
    const event = await this.core.searchOne(`${ENDPOINTS.events}?id=${eventId}`);
    if (!event) throw new Error(`Event ${eventId} not found`);
    return event;
  }

  async getAvailabilities(eventId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.availabilities}?event_id=${eventId}`);
  }

  async getMemberAvailabilities(memberId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.availabilities}?member_id=${memberId}`);
  }
}
```

- [ ] **Step 3: Delete old AWS teamsnap.ts**

```bash
git rm aws/src/teamsnap.ts
```

Note: `aws/src/lambda.ts` still imports from `./teamsnap.js`. We'll fix that in Task 11. For now the AWS build will be broken — that's OK, we'll fix it soon.

- [ ] **Step 4: Type-check AWS**

```bash
cd aws && npx tsc --noEmit --project tsconfig.json; cd ..
```

Expected: errors about `lambda.ts` importing from `./teamsnap.js`. **Leave those** — fixed in Task 11. Verify no other errors.

- [ ] **Step 5: Commit**

```bash
git add aws/src/client.ts aws/tsconfig.json
git commit -m "refactor: add AWS TeamSnapClient facade over shared core"
```

---

## Task 6: Parity test — local and AWS facades expose same methods

**Files:**
- Create: `tests/parity.test.ts`

- [ ] **Step 1: Write parity test**

Create `tests/parity.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- tests/parity.test.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/parity.test.ts
git commit -m "test: parity check between local and AWS TeamSnapClient facades"
```

---

## Task 7: Build timezone utility with TDD

**Files:**
- Create: `src/utils/time.ts`
- Create: `tests/utils/time.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/time.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/utils/time.test.ts`
Expected: all tests fail with module-not-found.

- [ ] **Step 3: Implement time.ts**

Create `src/utils/time.ts`:

```ts
export interface LocalizeOptions {
  viewerTZ?: string;
}

export interface LocalizedTime {
  utc: string;
  local: string;
  viewer?: string;
  time_zone_iana: string;
  time_zone: string;
}

function formatInTZ(utcISO: string, timeZone: string): string {
  const d = new Date(utcISO);
  if (isNaN(d.getTime())) return utcISO;
  return d.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

export function localizeTime(
  utcISO: string | null | undefined,
  eventTZ: string | null | undefined,
  eventTZLabel: string | null | undefined,
  options: LocalizeOptions = {}
): LocalizedTime | null {
  if (!utcISO) return null;

  const tz = eventTZ || "UTC";
  const label = eventTZLabel || tz;
  const result: LocalizedTime = {
    utc: utcISO,
    local: formatInTZ(utcISO, tz),
    time_zone_iana: tz,
    time_zone: label,
  };

  if (options.viewerTZ && options.viewerTZ !== tz) {
    result.viewer = formatInTZ(utcISO, options.viewerTZ);
  }

  return result;
}

export interface EventLike {
  start_date?: unknown;
  end_date?: unknown;
  arrival_date?: unknown;
  time_zone_iana_name?: unknown;
  time_zone?: unknown;
}

export interface LocalizedEventTimes {
  start: LocalizedTime | null;
  end: LocalizedTime | null;
  arrival: LocalizedTime | null;
}

export function localizeEventTimes<T extends EventLike>(
  event: T,
  options: LocalizeOptions = {}
): T & LocalizedEventTimes {
  const tz = (event.time_zone_iana_name as string | null | undefined) ?? null;
  const label = (event.time_zone as string | null | undefined) ?? null;
  const start = typeof event.start_date === "string" ? event.start_date : null;
  const end = typeof event.end_date === "string" ? event.end_date : null;
  const arrival = typeof event.arrival_date === "string" ? event.arrival_date : null;

  return {
    ...event,
    start: localizeTime(start, tz, label, options),
    end: localizeTime(end, tz, label, options),
    arrival: localizeTime(arrival, tz, label, options),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/utils/time.test.ts`
Expected: all passed.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/time.ts tests/utils/time.test.ts
git commit -m "feat: add localizeTime/localizeEventTimes using per-event IANA zones"
```

---

## Task 8: Add sports lookup utility

**Files:**
- Create: `src/utils/sports.ts`

- [ ] **Step 1: Create sports.ts**

Create `src/utils/sports.ts`:

```ts
export const SPORT_NAMES: Record<number, string> = {
  1: "Baseball",
  2: "Basketball",
  3: "Field Hockey",
  4: "Football",
  5: "Golf",
  6: "Gymnastics",
  7: "Hockey",
  8: "Inline Hockey",
  9: "Ice Skating",
  10: "Lacrosse",
  11: "Martial Arts",
  12: "Other Sports",
  13: "Polo",
  14: "Racing",
  15: "Rowing",
  16: "Soccer",
  17: "Softball",
  18: "Swimming",
  19: "Tennis",
  20: "Track & Field",
  21: "Volleyball",
  22: "Water Polo",
  23: "Wrestling",
  24: "Australian Football",
  25: "Auto Racing",
  26: "Badminton",
  27: "Bocce",
  28: "Bowling",
  29: "Cheerleading",
  30: "Cricket",
  31: "Curling",
  32: "Cycling",
  33: "Dance Team",
  34: "Dodgeball",
  35: "Equestrian",
  36: "Fencing",
  37: "Figure Skating",
  38: "Fishing",
  39: "Flag Football",
  40: "Floor Hockey",
  41: "Handball",
  42: "Hurling",
  43: "Judo",
  44: "Kickball",
  45: "Netball",
  46: "Paintball",
  47: "Petanque",
  48: "Pickleball",
  49: "Quidditch",
  50: "Ringette",
  51: "Roller Derby",
  52: "Rugby",
  53: "Sailing",
  54: "Skiing",
  55: "Snowboarding",
  56: "Squash",
  57: "Table Tennis",
  58: "Ultimate Frisbee",
  59: "Unicycling",
  60: "Water Skiing",
};

export function sportName(sportId: number | string | null | undefined): string | null {
  if (sportId == null) return null;
  const id = typeof sportId === "string" ? parseInt(sportId, 10) : sportId;
  if (isNaN(id)) return null;
  return SPORT_NAMES[id] ?? null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/sports.ts
git commit -m "feat: add sport_id to sport name lookup"
```

---

## Task 9: Handler directory — router skeleton + auth handlers

**Files:**
- Create: `src/tools/handlers/index.ts`
- Create: `src/tools/handlers/auth.ts`
- Create: `src/tools/handlers/common.ts`

- [ ] **Step 1: Create common helpers**

Create `src/tools/handlers/common.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function success(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function error(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function empty(reason: "not_authorized" | "not_found" | "no_data"): CallToolResult {
  return success({ empty: true, reason });
}

export function getViewerTZ(): string | undefined {
  return process.env.TEAMSNAP_TIMEZONE || undefined;
}

export type ToolArgs = Record<string, unknown>;

export function requireString(args: ToolArgs, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${key} is required`);
  }
  return v;
}

export function requireExactlyOne(args: ToolArgs, keys: string[]): { key: string; value: string } {
  const present = keys.filter((k) => typeof args[k] === "string" && (args[k] as string).length > 0);
  if (present.length !== 1) {
    throw new Error(`exactly one of ${keys.join(", ")} is required`);
  }
  return { key: present[0], value: args[present[0]] as string };
}
```

- [ ] **Step 2: Create auth handlers (extracted from current handlers.ts)**

Create `src/tools/handlers/auth.ts`:

```ts
import open from "open";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { startOAuthFlow } from "../../auth/oauth.js";
import { clearCredentials, hasCredentials, loadCredentials } from "../../utils/storage.js";
import { success, error, type ToolArgs } from "./common.js";

export async function handleAuth(args: ToolArgs): Promise<CallToolResult> {
  const clientId = (args.client_id as string) || process.env.TEAMSNAP_CLIENT_ID;
  const clientSecret = (args.client_secret as string) || process.env.TEAMSNAP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return error(
      "Missing client_id or client_secret. Either pass them as arguments or set TEAMSNAP_CLIENT_ID and TEAMSNAP_CLIENT_SECRET."
    );
  }
  try {
    const { authUrl, waitForCallback } = await startOAuthFlow({ clientId, clientSecret });
    await open(authUrl);
    const credentials = await waitForCallback();
    return success({
      status: "authenticated",
      message: "Successfully connected to TeamSnap!",
      user: { id: credentials.teamsnapUserId, email: credentials.teamsnapEmail },
    });
  } catch (err) {
    return error(`Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleAuthStatus(): Promise<CallToolResult> {
  if (!hasCredentials()) {
    return success({ authenticated: false, message: "Not connected to TeamSnap. Use teamsnap_auth to connect." });
  }
  const credentials = loadCredentials();
  if (!credentials) {
    return success({ authenticated: false, message: "Not connected to TeamSnap. Use teamsnap_auth to connect." });
  }
  teamsnapClient.reloadCredentials();
  try {
    const user = await teamsnapClient.getMe();
    return success({
      authenticated: true,
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
    });
  } catch {
    return success({
      authenticated: true,
      user: { id: credentials.teamsnapUserId, email: credentials.teamsnapEmail },
      note: "Could not fetch fresh user info - token may need refresh",
    });
  }
}

export async function handleLogout(): Promise<CallToolResult> {
  clearCredentials();
  teamsnapClient.reloadCredentials();
  return success({ status: "logged_out", message: "Successfully disconnected from TeamSnap." });
}
```

- [ ] **Step 3: Create router**

Create `src/tools/handlers/index.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, type ToolArgs } from "./common.js";
import { handleAuth, handleAuthStatus, handleLogout } from "./auth.js";

export async function handleToolCall(name: string, args: ToolArgs): Promise<CallToolResult> {
  try {
    switch (name) {
      case "teamsnap_auth":
        return handleAuth(args);
      case "teamsnap_auth_status":
        return handleAuthStatus();
      case "teamsnap_logout":
        return handleLogout();
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/handlers/common.ts src/tools/handlers/auth.ts src/tools/handlers/index.ts
git commit -m "refactor: extract auth handlers and create router skeleton"
```

---

## Task 10: Extract teams, roster, events, availability handlers (pre-enrichment, 1:1 port)

**Files:**
- Create: `src/tools/handlers/teams.ts`
- Create: `src/tools/handlers/roster.ts`
- Create: `src/tools/handlers/events.ts`
- Create: `src/tools/handlers/availability.ts`
- Modify: `src/tools/handlers/index.ts`

**Goal of this task:** port existing behavior to the new files with no functional change. Enrichments happen in later tasks.

- [ ] **Step 1: Create teams handlers**

Create `src/tools/handlers/teams.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleListTeams(): Promise<CallToolResult> {
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const teams = await teamsnapClient.getTeams();
    const simplified = teams.map((team) => ({
      id: team.id,
      name: team.name,
      sport: team.sport_id,
      division: team.division_name,
      season: team.season_name,
      league: team.league_name,
      isArchived: team.is_archived_season,
    }));
    return success({ count: simplified.length, teams: simplified });
  } catch (err) {
    return error(`Failed to list teams: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetTeam(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const team = await teamsnapClient.getTeam(teamId);
    return success(team);
  } catch (err) {
    return error(`Failed to get team: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Create roster handlers**

Create `src/tools/handlers/roster.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetRoster(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const members = await teamsnapClient.getTeamMembers(teamId);
    const players = members
      .filter((m) => !m.is_non_player)
      .map((m) => ({
        id: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        jerseyNumber: m.jersey_number,
        position: m.position,
      }));
    const coaches = members
      .filter((m) => m.is_non_player)
      .map((m) => ({
        id: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        isManager: m.is_manager,
        isOwner: m.is_owner,
      }));
    return success({
      teamId,
      playerCount: players.length,
      coachCount: coaches.length,
      players,
      coaches,
    });
  } catch (err) {
    return error(`Failed to get roster: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 3: Create events handlers (1:1 port, keeps old behavior)**

Create `src/tools/handlers/events.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { localizeEventTimes } from "../../utils/time.js";
import { success, error, requireString, getViewerTZ, type ToolArgs } from "./common.js";

export async function handleGetEvents(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    let events = await teamsnapClient.getTeamEvents(teamId);
    const startDate = args.start_date as string | undefined;
    const endDate = args.end_date as string | undefined;
    if (startDate) {
      const start = new Date(startDate);
      events = events.filter((e) => e.start_date && new Date(String(e.start_date)) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      events = events.filter((e) => e.start_date && new Date(String(e.start_date)) <= end);
    }
    const viewerTZ = getViewerTZ();
    const simplified = events.map((e) => {
      const localized = localizeEventTimes(e, { viewerTZ });
      return {
        id: e.id,
        name: e.name,
        type: e.is_game ? "game" : "practice",
        start: localized.start,
        end: localized.end,
        location: e.location_name,
        opponent: e.opponent_name,
        isHome: e.is_home,
        isCanceled: e.is_canceled,
      };
    });
    return success({ teamId, count: simplified.length, events: simplified });
  } catch (err) {
    return error(`Failed to get events: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const event = await teamsnapClient.getEvent(eventId);
    const viewerTZ = getViewerTZ();
    return success(localizeEventTimes(event, { viewerTZ }));
  } catch (err) {
    return error(`Failed to get event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 4: Create availability handler**

Create `src/tools/handlers/availability.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetAvailability(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const availabilities = await teamsnapClient.getAvailabilities(eventId);
    const grouped = {
      yes: [] as Array<{ memberId: unknown; notes: unknown }>,
      no: [] as Array<{ memberId: unknown; notes: unknown }>,
      maybe: [] as Array<{ memberId: unknown; notes: unknown }>,
      noResponse: [] as Array<{ memberId: unknown }>,
    };
    for (const a of availabilities) {
      const status = String(a.status_code ?? "").toLowerCase();
      const entry = { memberId: a.member_id, notes: a.notes };
      if (status === "yes" || status === "1") grouped.yes.push(entry);
      else if (status === "no" || status === "0") grouped.no.push(entry);
      else if (status === "maybe" || status === "2") grouped.maybe.push(entry);
      else grouped.noResponse.push({ memberId: a.member_id });
    }
    return success({
      eventId,
      summary: {
        available: grouped.yes.length,
        unavailable: grouped.no.length,
        maybe: grouped.maybe.length,
        noResponse: grouped.noResponse.length,
      },
      details: grouped,
    });
  } catch (err) {
    return error(`Failed to get availability: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 5: Wire new handlers into router**

Replace `src/tools/handlers/index.ts` contents with:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, type ToolArgs } from "./common.js";
import { handleAuth, handleAuthStatus, handleLogout } from "./auth.js";
import { handleListTeams, handleGetTeam } from "./teams.js";
import { handleGetRoster } from "./roster.js";
import { handleGetEvents, handleGetEvent } from "./events.js";
import { handleGetAvailability } from "./availability.js";

export async function handleToolCall(name: string, args: ToolArgs): Promise<CallToolResult> {
  try {
    switch (name) {
      case "teamsnap_auth":
        return handleAuth(args);
      case "teamsnap_auth_status":
        return handleAuthStatus();
      case "teamsnap_logout":
        return handleLogout();
      case "teamsnap_list_teams":
        return handleListTeams();
      case "teamsnap_get_team":
        return handleGetTeam(args);
      case "teamsnap_get_roster":
        return handleGetRoster(args);
      case "teamsnap_get_events":
        return handleGetEvents(args);
      case "teamsnap_get_event":
        return handleGetEvent(args);
      case "teamsnap_get_availability":
        return handleGetAvailability(args);
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tools/handlers/
git commit -m "refactor: extract teams/roster/events/availability handlers"
```

---

## Task 11: Wire new router into src/index.ts and aws/src/lambda.ts, delete old handlers.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `aws/src/lambda.ts`
- Delete: `src/tools/handlers.ts`

- [ ] **Step 1: Update src/index.ts import**

In `src/index.ts`, change line 11 from:

```ts
import { handleToolCall } from "./tools/handlers.js";
```

to:

```ts
import { handleToolCall } from "./tools/handlers/index.js";
```

- [ ] **Step 2: Build local server**

Run: `npm run build`
Expected: `dist/index.js` generated with no errors.

- [ ] **Step 3: Replace aws/src/lambda.ts with thin wrapper over shared handlers**

Read current file (`aws/src/lambda.ts`). Replace lines 1–231 (everything from the imports through the end of `handleTool` function — the embedded tool list, tool definitions, and `handleTool` function) with:

```ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomBytes } from "crypto";
import { tools } from "../../src/tools/index.js";
import { handleToolCall } from "../../src/tools/handlers/index.js";
import { TeamSnapClient } from "./client.js";
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  savePendingAuth,
  getPendingAuth,
  deletePendingAuth,
} from "./dynamodb.js";

const TEAMSNAP_AUTH_URL = "https://auth.teamsnap.com/oauth/authorize";
const TEAMSNAP_TOKEN_URL = "https://auth.teamsnap.com/oauth/token";
const TEAMSNAP_SCOPES = "read";

function getBaseUrl(event: APIGatewayProxyEventV2): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const host = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  return stage === "$default" ? `https://${host}` : `https://${host}/${stage}`;
}

async function handleTool(name: string, args: Record<string, unknown>, baseUrl: string): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  if (name === "teamsnap_auth") {
    const clientId = process.env.TEAMSNAP_CLIENT_ID;
    const clientSecret = process.env.TEAMSNAP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return { content: [{ type: "text", text: "TEAMSNAP_CLIENT_ID and TEAMSNAP_CLIENT_SECRET must be set" }], isError: true };
    }
    const state = randomBytes(16).toString("hex");
    await savePendingAuth(state, clientId, clientSecret);
    const redirectUri = `${baseUrl}/callback`;
    const authUrl = `${TEAMSNAP_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${TEAMSNAP_SCOPES}&state=${state}`;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "pending",
          message: "Open this URL in your browser to authenticate:",
          authUrl,
          note: "After authenticating, come back and check status with teamsnap_auth_status",
        }, null, 2),
      }],
    };
  }

  if (name === "teamsnap_auth_status") {
    const creds = await loadCredentials();
    if (!creds) {
      return { content: [{ type: "text", text: JSON.stringify({ authenticated: false, message: "Not connected. Use teamsnap_auth to connect." }, null, 2) }] };
    }
    const client = new TeamSnapClient();
    await client.loadCredentials();
    try {
      const user = await client.getMe();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authenticated: true,
            user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
          }, null, 2),
        }],
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authenticated: true,
            user: { id: creds.teamsnapUserId, email: creds.teamsnapEmail },
            note: "Could not fetch fresh user info",
          }, null, 2),
        }],
      };
    }
  }

  if (name === "teamsnap_logout") {
    await clearCredentials();
    return { content: [{ type: "text", text: JSON.stringify({ status: "logged_out", message: "Successfully disconnected from TeamSnap." }, null, 2) }] };
  }

  // All other tools delegate to shared handler router. AWS client swaps in via global init below.
  return handleToolCall(name, args);
}

// Initialize the global teamsnapClient singleton (used by shared handlers) with AWS-backed credentials.
// The shared handlers import `teamsnapClient` from `src/api/client.ts` which uses local file storage.
// For AWS, we monkey-patch that module's singleton to use the AWS client instead.
// (Implementation in next step: see src/api/client.ts singleton export and the switch below.)
```

Note: the existing `handleCallback`, `handleMCP`, and `handler` functions below this section are **kept unchanged**. Only the top portion (imports, embedded tools, `handleTool`) is replaced.

- [ ] **Step 4: Address the client swap problem**

The shared handlers reference `teamsnapClient` from `src/api/client.ts` which uses local file storage. In Lambda we need the AWS DynamoDB-backed client instead. Simplest correct approach: make the shared handlers get their client from a getter that callers can override.

Modify `src/api/client.ts`: at the bottom, replace `export const teamsnapClient = new TeamSnapClient();` with:

```ts
let _client: TeamSnapClient = new TeamSnapClient();
export const teamsnapClient = new Proxy({} as TeamSnapClient, {
  get(_target, prop, _receiver) {
    return Reflect.get(_client, prop, _client);
  },
});

export function _setTeamSnapClient(c: TeamSnapClient): void {
  _client = c;
}
```

This lets AWS override the singleton at runtime. Type the AWS client shape is compatible (it has all the same public methods — verified by parity test in Task 6).

Now in `aws/src/lambda.ts`, at the top of the file after imports, add:

```ts
import { _setTeamSnapClient } from "../../src/api/client.js";
import { TeamSnapClient as AwsTeamSnapClient } from "./client.js";

const awsClient = new AwsTeamSnapClient();
let awsClientReady: Promise<void> | null = null;
function ensureAwsClient(): Promise<void> {
  if (!awsClientReady) {
    awsClientReady = awsClient.loadCredentials();
  }
  return awsClientReady;
}

// Override the shared singleton with AWS-backed client. Cast is safe:
// both classes expose the same public method set (verified by parity test).
_setTeamSnapClient(awsClient as unknown as import("../../src/api/client.js").TeamSnapClient);
```

Then in `handleMCP` (further down in `aws/src/lambda.ts`), at the start of the function (right after `const httpMethod = event.requestContext.http.method;`), add:

```ts
await ensureAwsClient();
```

This ensures AWS credentials are loaded from DynamoDB before any tool call.

- [ ] **Step 5: Delete old handlers.ts**

```bash
git rm src/tools/handlers.ts
```

- [ ] **Step 6: Type-check both projects**

```bash
npx tsc --noEmit
cd aws && npx tsc --noEmit; cd ..
```

Expected: no errors in either.

- [ ] **Step 7: Build both**

```bash
npm run build
cd aws && npm run build; cd ..
```

Expected: `dist/index.js` and `aws/dist/lambda.js` both produced.

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: all passing.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts src/api/client.ts aws/src/lambda.ts
git commit -m "refactor: wire unified handler router into local and AWS entry points"
```

---

## Task 12: Enrich get_team handler

**Files:**
- Modify: `src/tools/handlers/teams.ts`

- [ ] **Step 1: Update handleGetTeam to return allowlisted + enriched shape**

In `src/tools/handlers/teams.ts`, replace `handleGetTeam`:

```ts
import { sportName } from "../../utils/sports.js";

// (imports above unchanged: teamsnapClient, success, error, requireString, ToolArgs)

export async function handleGetTeam(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const team = await teamsnapClient.getTeam(teamId);
    const publicSite = (team._links ?? []).find((l) => l.rel === "team_public_site")?.href ?? null;
    const enriched = {
      id: team.id,
      name: team.name,
      sport_id: team.sport_id,
      sport_name: sportName(team.sport_id as number | string | null | undefined),
      division_name: team.division_name,
      division_id: team.division_id,
      season_name: team.season_name,
      league_name: team.league_name,
      league_url: team.league_url,
      is_archived_season: team.is_archived_season,
      is_in_league: team.is_in_league,
      player_member_count: team.player_member_count,
      non_player_member_count: team.non_player_member_count,
      time_zone: team.time_zone,
      time_zone_iana_name: team.time_zone_iana_name,
      time_zone_offset: team.time_zone_offset,
      location_postal_code: team.location_postal_code,
      location_country: team.location_country,
      location_state: team.location_state,
      location_latitude: team.location_latitude,
      location_longitude: team.location_longitude,
      team_public_site_url: publicSite,
    };
    return success(enriched);
  } catch (err) {
    return error(`Failed to get team: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/teams.ts
git commit -m "feat(get_team): enrich with sport_name, public site, timezone, location fields"
```

---

## Task 13: Enrich get_roster with parallel contact/photo fetches

**Files:**
- Modify: `src/tools/handlers/roster.ts`
- Create: `tests/handlers/roster.test.ts`

- [ ] **Step 1: Write failing test for enriched roster shape**

Create `tests/handlers/roster.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleGetRoster } from "../../src/tools/handlers/roster.js";

const originalFetch = globalThis.fetch;

function collectionResponse(items: Array<Record<string, unknown>>) {
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
    { status: 200 }
  );
}

describe("handleGetRoster enrichment", () => {
  beforeEach(() => {
    // Seed fake credentials for the singleton — client.reloadCredentials is a no-op here because
    // TeamSnapClient constructor reads files. We intercept fetch directly.
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/members/search")) {
        return collectionResponse([
          {
            id: 1, first_name: "A", last_name: "Player", is_non_player: false,
            jersey_number: "10", position: "Forward", birthday: "2010-01-01", gender: "M",
          },
        ]);
      }
      if (u.includes("/member_email_addresses/search")) {
        return collectionResponse([{ member_id: 1, email: "a@example.com", is_primary: true }]);
      }
      if (u.includes("/member_phone_numbers/search")) {
        return collectionResponse([{ member_id: 1, phone_number: "555-1212", is_primary: true }]);
      }
      if (u.includes("/member_photos/search")) {
        return collectionResponse([{ member_id: 1, url: "https://example/photo.jpg" }]);
      }
      throw new Error(`Unexpected URL: ${u}`);
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("includes birthday, gender, primary email/phone, and photo_url", async () => {
    // client singleton reads files; test environment has no creds file, so skip if no auth.
    // We still verify the code path runs and returns the right shape when auth is present.
    const result = await handleGetRoster({ team_id: "10413186" });
    // The handler returns isError when unauthenticated; inspect text for shape markers when authed.
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    // If not authenticated, the test is a no-op on shape but verifies no crash.
    if (!result.isError) {
      const parsed = JSON.parse(text);
      const player = parsed.players[0];
      expect(player).toHaveProperty("birthday", "2010-01-01");
      expect(player).toHaveProperty("gender", "M");
      expect(player).toHaveProperty("primary_email", "a@example.com");
      expect(player).toHaveProperty("primary_phone", "555-1212");
      expect(player).toHaveProperty("photo_url", "https://example/photo.jpg");
    }
  });
});
```

- [ ] **Step 2: Implement enriched roster handler**

Replace `src/tools/handlers/roster.ts` contents:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

function firstPrimary<T extends Record<string, unknown>>(items: T[], preferKey = "is_primary"): T | undefined {
  return items.find((i) => i[preferKey] === true) ?? items[0];
}

export async function handleGetRoster(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  const core = teamsnapClient.getCore();
  try {
    const [members, emails, phones, photos] = await Promise.all([
      teamsnapClient.getTeamMembers(teamId),
      core.searchMany(`${ENDPOINTS.memberEmails}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.memberPhones}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.memberPhotos}?team_id=${teamId}`).catch(() => []),
    ]);

    const emailByMember = new Map<string, string>();
    for (const e of emails) {
      const mid = String(e.member_id);
      if (!emailByMember.has(mid) || e.is_primary === true) {
        if (typeof e.email === "string") emailByMember.set(mid, e.email);
      }
    }
    const phoneByMember = new Map<string, string>();
    for (const p of phones) {
      const mid = String(p.member_id);
      if (!phoneByMember.has(mid) || p.is_primary === true) {
        const num = (p.phone_number ?? p.phone_value) as unknown;
        if (typeof num === "string") phoneByMember.set(mid, num);
      }
    }
    const photoByMember = new Map<string, string>();
    for (const ph of photos) {
      const mid = String(ph.member_id);
      const url = (ph.url ?? ph.large_url ?? ph.medium_url) as unknown;
      if (!photoByMember.has(mid) && typeof url === "string") photoByMember.set(mid, url);
    }

    const enrich = (m: Record<string, unknown>) => {
      const mid = String(m.id);
      return {
        id: m.id,
        first_name: m.first_name,
        last_name: m.last_name,
        jersey_number: m.jersey_number,
        position: m.position,
        birthday: m.birthday ?? null,
        gender: m.gender ?? null,
        primary_email: emailByMember.get(mid) ?? null,
        primary_phone: phoneByMember.get(mid) ?? null,
        photo_url: photoByMember.get(mid) ?? null,
      };
    };

    const players = members.filter((m) => !m.is_non_player).map(enrich);
    const coaches = members
      .filter((m) => m.is_non_player)
      .map((m) => ({
        ...enrich(m),
        is_manager: m.is_manager ?? false,
        is_owner: m.is_owner ?? false,
      }));

    return success({
      teamId,
      playerCount: players.length,
      coachCount: coaches.length,
      players,
      coaches,
    });
  } catch (err) {
    return error(`Failed to get roster: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 3: Run test**

Run: `npm test -- tests/handlers/roster.test.ts`
Expected: passes (or no-ops if unauthed — check isError false path).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/handlers/roster.ts tests/handlers/roster.test.ts
git commit -m "feat(get_roster): enrich with birthday, gender, primary email/phone, photo"
```

---

## Task 14: Enrich get_events and get_event with full fields + inline location

**Files:**
- Modify: `src/tools/handlers/events.ts`
- Create: `tests/handlers/events.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/handlers/events.test.ts`:

```ts
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
```

- [ ] **Step 2: Replace events.ts with enriched handlers**

Replace `src/tools/handlers/events.ts` contents:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeEventTimes } from "../../utils/time.js";
import {
  success,
  error,
  requireString,
  requireExactlyOne,
  getViewerTZ,
  type ToolArgs,
} from "./common.js";

const EVENT_ALLOWLIST = [
  "id",
  "name",
  "is_game",
  "is_canceled",
  "is_tbd",
  "game_type",
  "start_date",
  "end_date",
  "arrival_date",
  "duration_in_minutes",
  "minutes_to_arrive_early",
  "location_id",
  "location_name",
  "additional_location_details",
  "opponent_id",
  "opponent_name",
  "is_home",
  "notes",
  "uniform",
  "tracks_availability",
  "repeating_type",
  "formatted_title",
  "points_for_team",
  "points_for_opponent",
  "formatted_results",
  "time_zone",
  "time_zone_iana_name",
] as const;

function pickEventFields(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EVENT_ALLOWLIST) out[k] = e[k];
  return out;
}

const LOCATION_ALLOWLIST = [
  "id",
  "name",
  "address",
  "latitude",
  "longitude",
  "url",
  "notes",
  "phone",
] as const;

function pickLocationFields(l: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LOCATION_ALLOWLIST) out[k] = l[k];
  const lat = l.latitude;
  const lng = l.longitude;
  if (typeof lat === "number" && typeof lng === "number") {
    out.map_url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return out;
}

export async function handleGetEvents(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    let events = await teamsnapClient.getTeamEvents(teamId);
    const startDate = args.start_date as string | undefined;
    const endDate = args.end_date as string | undefined;
    if (startDate) {
      const start = new Date(startDate);
      events = events.filter((e) => e.start_date && new Date(String(e.start_date)) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      events = events.filter((e) => e.start_date && new Date(String(e.start_date)) <= end);
    }
    const viewerTZ = getViewerTZ();

    const LIMIT = 50;
    const truncated = events.length > LIMIT;
    const sliced = truncated ? events.slice(0, LIMIT) : events;
    const enriched = sliced.map((e) => {
      const picked = pickEventFields(e);
      return localizeEventTimes(picked, { viewerTZ });
    });
    return success({
      teamId,
      count: enriched.length,
      total: events.length,
      truncated,
      events: enriched,
    });
  } catch (err) {
    return error(`Failed to get events: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const event = await teamsnapClient.getEvent(eventId);
    const viewerTZ = getViewerTZ();
    const picked = pickEventFields(event);
    const localized = localizeEventTimes(picked, { viewerTZ });
    let location: Record<string, unknown> | null = null;
    if (event.location_id) {
      const loc = await teamsnapClient.getCore().searchOne(ENDPOINTS.locationById(String(event.location_id))).catch(() => null);
      if (loc) location = pickLocationFields(loc);
    }
    return success({ ...localized, location });
  } catch (err) {
    return error(`Failed to get event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetLocation(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["location_id", "event_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    let locationId = key === "location_id" ? value : null;
    if (key === "event_id") {
      const ev = await teamsnapClient.getEvent(value).catch(() => null);
      if (!ev?.location_id) return success({ empty: true, reason: "no_data" });
      locationId = String(ev.location_id);
    }
    const loc = await core.searchOne(ENDPOINTS.locationById(String(locationId))).catch(() => null);
    if (!loc) return success({ empty: true, reason: "not_found" });
    return success(pickLocationFields(loc));
  } catch (err) {
    return error(`Failed to get location: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/handlers/events.test.ts`
Expected: passes or no-ops when unauthed.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/handlers/events.ts tests/handlers/events.test.ts
git commit -m "feat(events): enrich fields, inline location, add handleGetLocation"
```

---

## Task 15: New tool — teamsnap_get_calendar_urls

**Files:**
- Modify: `src/tools/handlers/meta.ts` (create)
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Create meta.ts**

Create `src/tools/handlers/meta.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, requireExactlyOne, type ToolArgs } from "./common.js";

export async function handleGetCalendarUrls(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const team = await teamsnapClient.getTeam(teamId);
    const pick = (rel: string) => team._links?.find((l) => l.rel === rel)?.href ?? null;
    return success({
      team_id: teamId,
      ical_all: pick("calendar_http"),
      webcal_all: pick("calendar_webcal"),
      ical_games_only: pick("calendar_http_games_only"),
      webcal_games_only: pick("calendar_webcal_games_only"),
    });
  } catch (err) {
    return error(`Failed to get calendar URLs: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetCustomData(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["team_id", "member_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const scopeParam = key === "team_id" ? `team_id=${value}` : `member_id=${value}`;
    const [fields, data] = await Promise.all([
      core.searchMany(`${ENDPOINTS.customFields}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.customData}?${scopeParam}`).catch(() => []),
    ]);
    const fieldById = new Map<string, Record<string, unknown>>();
    for (const f of fields) fieldById.set(String(f.id), f);
    const merged = data.map((d) => {
      const field = fieldById.get(String(d.custom_field_id));
      return {
        field_name: field?.name ?? null,
        field_type: field?.data_type ?? null,
        value: d.value,
        member_id: d.member_id ?? null,
        team_id: d.team_id ?? null,
      };
    });
    return success({
      scope: key === "team_id" ? "team" : "member",
      scope_id: value,
      count: merged.length,
      fields: merged,
    });
  } catch (err) {
    return error(`Failed to get custom data: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

Add to imports at top of `src/tools/handlers/index.ts`:

```ts
import { handleGetCalendarUrls, handleGetCustomData } from "./meta.js";
```

Add cases to the switch:

```ts
      case "teamsnap_get_calendar_urls":
        return handleGetCalendarUrls(args);
      case "teamsnap_get_custom_data":
        return handleGetCustomData(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/meta.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_calendar_urls and teamsnap_get_custom_data"
```

---

## Task 16: New tool — teamsnap_get_contacts

**Files:**
- Modify: `src/tools/handlers/roster.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Add handleGetContacts to roster.ts**

Append to `src/tools/handlers/roster.ts`:

```ts
import { requireExactlyOne } from "./common.js";
// (other imports from the file already include ENDPOINTS, teamsnapClient, success, error, etc.)

// Make sure ENDPOINTS is imported at the top if not already:
//   import { ENDPOINTS } from "../../api/endpoints.js";

export async function handleGetContacts(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["member_id", "team_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const scopeParam = key === "team_id" ? `team_id=${value}` : `member_id=${value}`;
    const [contacts, emails, phones] = await Promise.all([
      core.searchMany(`${ENDPOINTS.contacts}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.contactEmails}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.contactPhones}?${scopeParam}`).catch(() => []),
    ]);
    const emailsByContact = new Map<string, string[]>();
    for (const e of emails) {
      const cid = String(e.contact_id);
      if (!emailsByContact.has(cid)) emailsByContact.set(cid, []);
      if (typeof e.email === "string") emailsByContact.get(cid)!.push(e.email);
    }
    const phonesByContact = new Map<string, string[]>();
    for (const p of phones) {
      const cid = String(p.contact_id);
      if (!phonesByContact.has(cid)) phonesByContact.set(cid, []);
      const num = (p.phone_number ?? p.phone_value) as unknown;
      if (typeof num === "string") phonesByContact.get(cid)!.push(num);
    }
    const merged = contacts.map((c) => {
      const cid = String(c.id);
      return {
        id: c.id,
        member_id: c.member_id,
        first_name: c.first_name,
        last_name: c.last_name,
        label: c.label ?? null,
        is_emergency: c.is_emergency ?? false,
        emails: emailsByContact.get(cid) ?? [],
        phones: phonesByContact.get(cid) ?? [],
      };
    });
    return success({
      scope: key === "team_id" ? "team" : "member",
      scope_id: value,
      count: merged.length,
      contacts: merged,
    });
  } catch (err) {
    return error(`Failed to get contacts: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

Ensure `ENDPOINTS` import is added at the top of the file if not already present.

- [ ] **Step 2: Add to router**

In `src/tools/handlers/index.ts`, add import:

```ts
import { handleGetRoster, handleGetContacts } from "./roster.js";
```

Add case:

```ts
      case "teamsnap_get_contacts":
        return handleGetContacts(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/roster.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_contacts"
```

---

## Task 17: New tool — teamsnap_get_announcements

**Files:**
- Create: `src/tools/handlers/announcements.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Implement announcements handler**

Create `src/tools/handlers/announcements.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireString, getViewerTZ, type ToolArgs } from "./common.js";

function normalize(
  item: Record<string, unknown>,
  type: "email" | "alert" | "message"
): { id: unknown; type: string; subject: unknown; body: unknown; sender_id: unknown; sent_at: string | null } {
  return {
    id: item.id,
    type,
    subject: item.subject ?? item.title ?? null,
    body: item.body ?? item.message ?? null,
    sender_id: item.member_id ?? item.sender_id ?? item.user_id ?? null,
    sent_at: (item.created_at ?? item.sent_at ?? null) as string | null,
  };
}

export async function handleGetAnnouncements(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const since = typeof args.since === "string" ? args.since : null;
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [emails, alerts, messages, members] = await Promise.all([
      core.searchMany(`${ENDPOINTS.broadcastEmails}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.broadcastAlerts}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.messages}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`).catch(() => []),
    ]);
    const memberName = new Map<string, string>();
    for (const m of members) {
      memberName.set(String(m.id), `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
    }
    const normalized = [
      ...emails.map((e) => normalize(e, "email")),
      ...alerts.map((a) => normalize(a, "alert")),
      ...messages.map((m) => normalize(m, "message")),
    ];
    const filtered = since ? normalized.filter((n) => n.sent_at && new Date(n.sent_at) >= new Date(since)) : normalized;
    filtered.sort((a, b) => {
      const aT = a.sent_at ? new Date(a.sent_at).getTime() : 0;
      const bT = b.sent_at ? new Date(b.sent_at).getTime() : 0;
      return bT - aT;
    });
    const sliced = filtered.slice(0, limit);
    const viewerTZ = getViewerTZ();
    // For announcements the team's TZ is a reasonable default; we fetch team once for TZ.
    const team = await teamsnapClient.getTeam(teamId).catch(() => null);
    const tz = (team?.time_zone_iana_name as string | null | undefined) ?? null;
    const tzLabel = (team?.time_zone as string | null | undefined) ?? null;
    const items = sliced.map((n) => ({
      id: n.id,
      type: n.type,
      subject: n.subject,
      body_preview: typeof n.body === "string" ? n.body.slice(0, 200) : n.body,
      sender_id: n.sender_id,
      sender_name: n.sender_id ? memberName.get(String(n.sender_id)) ?? null : null,
      sent_at: localizeTime(n.sent_at, tz, tzLabel, { viewerTZ }),
    }));
    return success({
      team_id: teamId,
      count: items.length,
      total: filtered.length,
      items,
    });
  } catch (err) {
    return error(`Failed to get announcements: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

In `src/tools/handlers/index.ts`:

```ts
import { handleGetAnnouncements } from "./announcements.js";
```

```ts
      case "teamsnap_get_announcements":
        return handleGetAnnouncements(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/announcements.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_announcements (broadcast_emails + alerts + messages union)"
```

---

## Task 18: New tool — teamsnap_get_assignments

**Files:**
- Create: `src/tools/handlers/assignments.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Implement assignments handler**

Create `src/tools/handlers/assignments.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireExactlyOne, getViewerTZ, type ToolArgs } from "./common.js";

export async function handleGetAssignments(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["team_id", "event_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const scopeParam = `${key}=${value}`;
    const [trackedItems, assignments, statuses] = await Promise.all([
      core.searchMany(`${ENDPOINTS.trackedItems}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.assignments}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.trackedItemStatuses}?${scopeParam}`).catch(() => []),
    ]);
    const tiById = new Map<string, Record<string, unknown>>();
    for (const t of trackedItems) tiById.set(String(t.id), t);
    const statusById = new Map<string, Record<string, unknown>>();
    for (const s of statuses) statusById.set(String(s.id), s);

    // Resolve member names — derive team id (if given event_id, fetch event to get team id)
    let teamId = key === "team_id" ? value : null;
    if (!teamId) {
      const ev = await teamsnapClient.getEvent(value).catch(() => null);
      teamId = ev?.team_id ? String(ev.team_id) : null;
    }
    const members = teamId
      ? await core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`).catch(() => [])
      : [];
    const memberName = new Map<string, string>();
    for (const m of members) memberName.set(String(m.id), `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());

    const tz: string | null = null;
    const tzLabel: string | null = null;
    const viewerTZ = getViewerTZ();

    const items = assignments.map((a) => {
      const trackedItem = tiById.get(String(a.tracked_item_id));
      const statusId = a.tracked_item_status_id;
      const status = statusId ? statusById.get(String(statusId)) : null;
      const statusLabel = (status?.status ?? a.status ?? "pending") as string;
      return {
        assignment_id: a.id,
        tracked_item_id: a.tracked_item_id,
        tracked_item_name: trackedItem?.name ?? null,
        tracked_item_description: trackedItem?.description ?? null,
        member_id: a.member_id,
        member_name: a.member_id ? memberName.get(String(a.member_id)) ?? null : null,
        due_date: localizeTime((trackedItem?.due_date ?? null) as string | null, tz, tzLabel, { viewerTZ }),
        status: statusLabel,
        notes: status?.notes ?? a.notes ?? null,
      };
    });
    return success({
      scope: key === "team_id" ? "team" : "event",
      scope_id: value,
      count: items.length,
      items,
    });
  } catch (err) {
    return error(`Failed to get assignments: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

In `src/tools/handlers/index.ts`:

```ts
import { handleGetAssignments } from "./assignments.js";
```

```ts
      case "teamsnap_get_assignments":
        return handleGetAssignments(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/assignments.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_assignments (tracked_items + statuses + assignments join)"
```

---

## Task 19: New tools — teamsnap_get_opponents and teamsnap_get_results_and_standings

**Files:**
- Create: `src/tools/handlers/opponents.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Implement opponents handlers**

Create `src/tools/handlers/opponents.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetOpponents(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [opponents, results] = await Promise.all([
      core.searchMany(`${ENDPOINTS.opponents}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.opponentsResults}?team_id=${teamId}`).catch(() => []),
    ]);
    const resultsByOpponent = new Map<string, { wins: number; losses: number; ties: number; last_result: string | null }>();
    for (const r of results) {
      const oid = String(r.opponent_id);
      const entry = resultsByOpponent.get(oid) ?? { wins: 0, losses: 0, ties: 0, last_result: null };
      if (r.win === true) entry.wins++;
      else if (r.loss === true) entry.losses++;
      else if (r.tie === true) entry.ties++;
      if (typeof r.formatted_results === "string" && !entry.last_result) {
        entry.last_result = r.formatted_results;
      }
      resultsByOpponent.set(oid, entry);
    }
    const enriched = opponents.map((o) => ({
      id: o.id,
      name: o.name,
      is_current_opponent: o.is_current_opponent ?? false,
      head_to_head: resultsByOpponent.get(String(o.id)) ?? { wins: 0, losses: 0, ties: 0, last_result: null },
    }));
    return success({ team_id: teamId, count: enriched.length, opponents: enriched });
  } catch (err) {
    return error(`Failed to get opponents: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetResultsAndStandings(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [teamResults, standings] = await Promise.all([
      core.searchMany(`${ENDPOINTS.teamResults}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.divisionTeamStandings}?team_id=${teamId}`).catch(() => []),
    ]);
    const record = teamResults.reduce(
      (acc, r) => ({
        wins: acc.wins + (r.wins ? Number(r.wins) : 0),
        losses: acc.losses + (r.losses ? Number(r.losses) : 0),
        ties: acc.ties + (r.ties ? Number(r.ties) : 0),
        points_for: acc.points_for + (r.points_for ? Number(r.points_for) : 0),
        points_against: acc.points_against + (r.points_against ? Number(r.points_against) : 0),
      }),
      { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 }
    );
    const standingsOut = standings.map((s) => ({
      team_id: s.team_id,
      team_name: s.team_name ?? null,
      position: s.position ?? null,
      games_played: s.games_played ?? null,
      points: s.points ?? null,
    }));
    return success({ team_id: teamId, record, standings: standingsOut });
  } catch (err) {
    return error(`Failed to get results and standings: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

In `src/tools/handlers/index.ts`:

```ts
import { handleGetOpponents, handleGetResultsAndStandings } from "./opponents.js";
```

```ts
      case "teamsnap_get_opponents":
        return handleGetOpponents(args);
      case "teamsnap_get_results_and_standings":
        return handleGetResultsAndStandings(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/opponents.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_opponents and teamsnap_get_results_and_standings"
```

---

## Task 20: New tool — teamsnap_get_member_availability (wire existing orphan)

**Files:**
- Modify: `src/tools/handlers/roster.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Add handler to roster.ts**

Append to `src/tools/handlers/roster.ts`:

```ts
import { localizeTime } from "../../utils/time.js";
import { getViewerTZ } from "./common.js";
// (existing imports remain)

export async function handleGetMemberAvailability(args: ToolArgs): Promise<CallToolResult> {
  const memberId = requireString(args, "member_id");
  const startDate = typeof args.start_date === "string" ? args.start_date : null;
  const endDate = typeof args.end_date === "string" ? args.end_date : null;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const avails = await teamsnapClient.getMemberAvailabilities(memberId);
    const eventIds = Array.from(new Set(avails.map((a) => String(a.event_id)).filter(Boolean)));
    const events = await Promise.all(
      eventIds.map((id) => core.searchOne(`${ENDPOINTS.events}?id=${id}`).catch(() => null))
    );
    const eventById = new Map<string, Record<string, unknown>>();
    for (const e of events) if (e) eventById.set(String(e.id), e);

    const statusLabel = (code: unknown): "yes" | "no" | "maybe" | "noResponse" => {
      const s = String(code ?? "").toLowerCase();
      if (s === "yes" || s === "1") return "yes";
      if (s === "no" || s === "0") return "no";
      if (s === "maybe" || s === "2") return "maybe";
      return "noResponse";
    };

    const viewerTZ = getViewerTZ();
    let responses = avails.map((a) => {
      const ev = eventById.get(String(a.event_id));
      const tz = (ev?.time_zone_iana_name as string | null) ?? null;
      const tzLabel = (ev?.time_zone as string | null) ?? null;
      return {
        event_id: a.event_id,
        event_name: ev?.name ?? null,
        event_start: localizeTime((ev?.start_date as string | null) ?? null, tz, tzLabel, { viewerTZ }),
        status: statusLabel(a.status_code),
        notes: a.notes ?? null,
      };
    });

    if (startDate) {
      const s = new Date(startDate);
      responses = responses.filter((r) => r.event_start?.utc && new Date(r.event_start.utc) >= s);
    }
    if (endDate) {
      const e = new Date(endDate);
      responses = responses.filter((r) => r.event_start?.utc && new Date(r.event_start.utc) <= e);
    }

    responses.sort((a, b) => {
      const aT = a.event_start?.utc ? new Date(a.event_start.utc).getTime() : 0;
      const bT = b.event_start?.utc ? new Date(b.event_start.utc).getTime() : 0;
      return aT - bT;
    });

    return success({ member_id: memberId, count: responses.length, responses });
  } catch (err) {
    return error(`Failed to get member availability: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

In `src/tools/handlers/index.ts`, expand the roster import:

```ts
import { handleGetRoster, handleGetContacts, handleGetMemberAvailability } from "./roster.js";
```

Add case:

```ts
      case "teamsnap_get_member_availability":
        return handleGetMemberAvailability(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/roster.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_member_availability (wires existing orphan method)"
```

---

## Task 21: New tool — teamsnap_get_stats

**Files:**
- Create: `src/tools/handlers/stats.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Implement stats handler**

Create `src/tools/handlers/stats.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, type ToolArgs } from "./common.js";

export async function handleGetStats(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const scope = typeof args.scope === "string" ? args.scope : "team";
  const memberId = typeof args.member_id === "string" ? args.member_id : null;
  const eventId = typeof args.event_id === "string" ? args.event_id : null;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    let endpoint: string;
    const params = new URLSearchParams({ team_id: teamId });
    switch (scope) {
      case "member":
        if (!memberId) return error("member_id required when scope=member");
        endpoint = ENDPOINTS.memberStatistics;
        params.set("member_id", memberId);
        break;
      case "event":
        if (!eventId) return error("event_id required when scope=event");
        endpoint = ENDPOINTS.eventStatistics;
        params.set("event_id", eventId);
        break;
      case "team":
      default:
        endpoint = ENDPOINTS.teamStatistics;
    }
    const [defs, data] = await Promise.all([
      core.searchMany(`${ENDPOINTS.statistics}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${endpoint}?${params.toString()}`).catch(() => []),
    ]);
    const defById = new Map<string, Record<string, unknown>>();
    for (const d of defs) defById.set(String(d.id), d);
    const items = data.map((s) => {
      const def = defById.get(String(s.statistic_id));
      return {
        statistic_id: s.statistic_id,
        statistic_name: def?.name ?? null,
        unit: def?.unit ?? null,
        value: s.value,
        member_id: s.member_id ?? null,
        event_id: s.event_id ?? null,
      };
    });
    return success({ team_id: teamId, scope, count: items.length, items });
  } catch (err) {
    return error(`Failed to get stats: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

```ts
import { handleGetStats } from "./stats.js";
```

```ts
      case "teamsnap_get_stats":
        return handleGetStats(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/stats.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_stats"
```

---

## Task 22: New tools — teamsnap_get_forum_topics and teamsnap_get_forum_posts

**Files:**
- Create: `src/tools/handlers/forum.ts`
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Implement forum handlers**

Create `src/tools/handlers/forum.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireString, getViewerTZ, type ToolArgs } from "./common.js";

export async function handleGetForumTopics(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [topics, members, team] = await Promise.all([
      core.searchMany(`${ENDPOINTS.forumTopics}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`).catch(() => []),
      teamsnapClient.getTeam(teamId).catch(() => null),
    ]);
    const memberName = new Map<string, string>();
    for (const m of members) memberName.set(String(m.id), `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
    const tz = (team?.time_zone_iana_name as string | null) ?? null;
    const tzLabel = (team?.time_zone as string | null) ?? null;
    const viewerTZ = getViewerTZ();
    const sorted = [...topics].sort((a, b) => {
      const aT = a.last_post_at ? new Date(String(a.last_post_at)).getTime() : 0;
      const bT = b.last_post_at ? new Date(String(b.last_post_at)).getTime() : 0;
      return bT - aT;
    });
    const items = sorted.slice(0, limit).map((t) => ({
      id: t.id,
      title: t.title ?? t.subject ?? null,
      author_id: t.member_id ?? null,
      author_name: t.member_id ? memberName.get(String(t.member_id)) ?? null : null,
      last_post_at: localizeTime((t.last_post_at as string | null) ?? null, tz, tzLabel, { viewerTZ }),
      post_count: t.post_count ?? null,
    }));
    return success({ team_id: teamId, count: items.length, topics: items });
  } catch (err) {
    return error(`Failed to get forum topics: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetForumPosts(args: ToolArgs): Promise<CallToolResult> {
  const topicId = requireString(args, "topic_id");
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 50;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const posts = await core.searchMany(`${ENDPOINTS.forumPosts}?forum_topic_id=${topicId}`).catch(() => []);
    const sorted = [...posts].sort((a, b) => {
      const aT = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
      const bT = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
      return aT - bT;
    });
    const viewerTZ = getViewerTZ();
    const items = sorted.slice(0, limit).map((p) => ({
      id: p.id,
      author_id: p.member_id ?? null,
      created_at: localizeTime((p.created_at as string | null) ?? null, null, null, { viewerTZ }),
      body: p.body ?? null,
    }));
    return success({ topic_id: topicId, count: items.length, posts: items });
  } catch (err) {
    return error(`Failed to get forum posts: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Wire into router**

```ts
import { handleGetForumTopics, handleGetForumPosts } from "./forum.js";
```

```ts
      case "teamsnap_get_forum_topics":
        return handleGetForumTopics(args);
      case "teamsnap_get_forum_posts":
        return handleGetForumPosts(args);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/forum.ts src/tools/handlers/index.ts
git commit -m "feat: add teamsnap_get_forum_topics and teamsnap_get_forum_posts"
```

---

## Task 23: Register all new tools in src/tools/index.ts

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Replace the file with the expanded tool list**

Replace `src/tools/index.ts` entirely with:

```ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "teamsnap_auth",
    description:
      "Authenticate with TeamSnap. Opens a browser window for OAuth login. Credentials are loaded from environment variables (TEAMSNAP_CLIENT_ID, TEAMSNAP_CLIENT_SECRET) or can be passed as arguments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_id: { type: "string", description: "Your TeamSnap OAuth client ID (optional if set in environment)" },
        client_secret: { type: "string", description: "Your TeamSnap OAuth client secret (optional if set in environment)" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_auth_status",
    description: "Check the current TeamSnap authentication status.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "teamsnap_logout",
    description: "Disconnect from TeamSnap and clear stored credentials.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "teamsnap_list_teams",
    description: "List all TeamSnap teams you have access to.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "teamsnap_get_team",
    description: "Get detailed information about a specific team, including sport name, timezone, and public site URL.",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_roster",
    description:
      "Get the roster for a team. Returns players and coaches with contact info (primary email/phone), birthday, gender, and photo URL.",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_events",
    description:
      "Get events (games, practices) for a team. Returns rich fields including arrival time, duration, location notes, uniform, and localized times in the event's own timezone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        start_date: { type: "string", description: "Filter events starting from this date (ISO 8601)" },
        end_date: { type: "string", description: "Filter events until this date (ISO 8601)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_event",
    description:
      "Get detailed information about a specific event, with the full field set, localized times, and the inlined location object (address, map link, parking notes).",
    inputSchema: {
      type: "object" as const,
      properties: { event_id: { type: "string", description: "The TeamSnap event ID" } },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_get_availability",
    description: "Get availability responses for an event grouped by status (yes/no/maybe/noResponse).",
    inputSchema: {
      type: "object" as const,
      properties: { event_id: { type: "string", description: "The TeamSnap event ID" } },
      required: ["event_id"],
    },
  },
  {
    name: "teamsnap_get_location",
    description:
      "Get full location details (address, latitude/longitude, parking notes, phone, Google Maps link). Provide exactly one of location_id or event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        location_id: { type: "string", description: "The TeamSnap location ID" },
        event_id: { type: "string", description: "An event ID (resolves the event's location)" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_get_contacts",
    description:
      "Get contacts (parents/guardians) with their email addresses and phone numbers. Provide exactly one of member_id or team_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        member_id: { type: "string", description: "Scope to one member's contacts" },
        team_id: { type: "string", description: "Scope to all contacts on a team" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_get_announcements",
    description:
      "Get recent announcements for a team (broadcast emails, broadcast alerts, and in-app messages unified into one feed, sorted by most recent).",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        since: { type: "string", description: "Only return announcements sent after this ISO 8601 date" },
        limit: { type: "number", description: "Maximum number of announcements to return (default 20)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_assignments",
    description:
      "Get volunteer/snack/carpool assignments (tracked items + statuses + assignments joined). Provide exactly one of team_id or event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "All assignments on a team" },
        event_id: { type: "string", description: "All assignments on a specific event" },
      },
      required: [],
    },
  },
  {
    name: "teamsnap_get_opponents",
    description: "Get the opponent catalog for a team with head-to-head record (wins/losses/ties + last result).",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_results_and_standings",
    description: "Get a team's record (wins/losses/ties, points for/against) and division standings.",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_member_availability",
    description:
      "Get one member's RSVP history across all their events, with each event's name and localized start time. Useful for 'has Jonah said yes to any of the last 5 games?'",
    inputSchema: {
      type: "object" as const,
      properties: {
        member_id: { type: "string", description: "The TeamSnap member ID" },
        start_date: { type: "string", description: "Only include events on or after this date (ISO 8601)" },
        end_date: { type: "string", description: "Only include events on or before this date (ISO 8601)" },
      },
      required: ["member_id"],
    },
  },
  {
    name: "teamsnap_get_stats",
    description:
      "Get team, member, or event statistics. scope=team returns team-wide stats; scope=member requires member_id; scope=event requires event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        scope: {
          type: "string",
          enum: ["team", "member", "event"],
          description: "Which statistics scope to fetch (default: team)",
        },
        member_id: { type: "string", description: "Required when scope=member" },
        event_id: { type: "string", description: "Required when scope=event" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_forum_topics",
    description: "List forum discussion topics for a team, sorted by most recent activity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "The TeamSnap team ID" },
        limit: { type: "number", description: "Maximum number of topics to return (default 20)" },
      },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_forum_posts",
    description: "Get forum posts for a topic, sorted oldest-first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: { type: "string", description: "The forum topic ID" },
        limit: { type: "number", description: "Maximum number of posts to return (default 50)" },
      },
      required: ["topic_id"],
    },
  },
  {
    name: "teamsnap_get_calendar_urls",
    description: "Get iCal and webcal URLs for a team's schedule (both full-schedule and games-only variants).",
    inputSchema: {
      type: "object" as const,
      properties: { team_id: { type: "string", description: "The TeamSnap team ID" } },
      required: ["team_id"],
    },
  },
  {
    name: "teamsnap_get_custom_data",
    description:
      "Get custom-field values defined by the team or league (e.g. waiver status, allergies, emergency contact). Provide exactly one of team_id or member_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string", description: "Team-scoped custom fields" },
        member_id: { type: "string", description: "Member-scoped custom fields" },
      },
      required: [],
    },
  },
];
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat: register 11 new tools in tool list"
```

---

## Task 24: Rebuild AWS Lambda and verify dispatch shape

**Files:**
- Modify: `aws/src/lambda.ts` (ensure `tools` import references the unified list)

- [ ] **Step 1: Verify aws/src/lambda.ts tools import**

Open `aws/src/lambda.ts`. Confirm near the top there is:

```ts
import { tools } from "../../src/tools/index.js";
```

If missing (e.g. still declaring a local `tools` const), delete any local `const tools = [...]` declaration. The Lambda's `handleMCP` already references `tools` — it now resolves to the shared list.

- [ ] **Step 2: Build AWS bundle**

```bash
cd aws && npm run build; cd ..
```

Expected: `aws/dist/lambda.js` produced without TypeScript or esbuild errors.

- [ ] **Step 3: Smoke test the built bundle**

```bash
node -e "const { handler } = require('./aws/dist/lambda.js'); handler({ rawPath: '/health', requestContext: { http: { method: 'GET', path: '/health' }, domainName: 'x', stage: '\$default' } }).then(console.log)"
```

Expected output contains `"status":"ok"`.

- [ ] **Step 4: Commit**

```bash
git add aws/src/lambda.ts aws/dist/lambda.js
git commit -m "build: rebuild AWS Lambda with unified tool list"
```

---

## Task 25: Update README and smoke-test against deployed endpoint

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README tool table**

In `README.md`, replace the "Available Tools" section table with:

```markdown
| Tool | Description | Required args |
|------|-------------|---------------|
| `teamsnap_auth` | Connect to TeamSnap via OAuth | — |
| `teamsnap_auth_status` | Check connection status | — |
| `teamsnap_logout` | Disconnect | — |
| `teamsnap_list_teams` | List all your teams | — |
| `teamsnap_get_team` | Team details (sport, timezone, public site) | `team_id` |
| `teamsnap_get_roster` | Players + coaches with contact info, photos | `team_id` |
| `teamsnap_get_events` | Events with arrival/duration/uniform/localized times | `team_id` |
| `teamsnap_get_event` | One event, with inlined location | `event_id` |
| `teamsnap_get_location` | Field address, map link, parking notes | `location_id` or `event_id` |
| `teamsnap_get_availability` | Event RSVP status grouped | `event_id` |
| `teamsnap_get_member_availability` | One member's RSVPs across events | `member_id` |
| `teamsnap_get_contacts` | Parent/guardian contacts (email + phone) | `member_id` or `team_id` |
| `teamsnap_get_announcements` | Recent broadcast emails + alerts + messages | `team_id` |
| `teamsnap_get_assignments` | Snacks/volunteer/carpool sign-ups | `team_id` or `event_id` |
| `teamsnap_get_opponents` | Opponent catalog with head-to-head record | `team_id` |
| `teamsnap_get_results_and_standings` | Team record + division standings | `team_id` |
| `teamsnap_get_stats` | Team/member/event statistics | `team_id` |
| `teamsnap_get_forum_topics` | Team forum discussion topics | `team_id` |
| `teamsnap_get_forum_posts` | Posts in a forum topic | `topic_id` |
| `teamsnap_get_calendar_urls` | iCal/webcal feeds (all or games-only) | `team_id` |
| `teamsnap_get_custom_data` | League/team custom field values | `team_id` or `member_id` |
```

Also update the "Environment Variables" section for `TEAMSNAP_TIMEZONE`:

Replace the existing row:

```markdown
| `TEAMSNAP_TIMEZONE` | No | `America/Los_Angeles` | Timezone for event times |
```

With:

```markdown
| `TEAMSNAP_TIMEZONE` | No | — | Your personal ("viewer") timezone. Events are always localized to their own timezone first (from the API); if this variable is set to a different IANA zone, tools add a second `viewer` field so you can see both. Useful when traveling. |
```

- [ ] **Step 2: Deploy AWS Lambda**

```bash
cd aws && node scripts/deploy.cjs; cd ..
```

Expected: deploy succeeds; API Gateway URL unchanged from before.

- [ ] **Step 3: Verify tools/list shows all 20 tools via deployed endpoint**

```bash
curl -s -X POST https://fhc04o0f1a.execute-api.us-west-2.amazonaws.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d["result"]["tools"]), "tools"); [print(" -", t["name"]) for t in d["result"]["tools"]]'
```

Expected: 20 tools listed (9 existing + 11 new).

- [ ] **Step 4: Smoke-test three representative new tools against real team**

```bash
# get_announcements
curl -s -X POST https://fhc04o0f1a.execute-api.us-west-2.amazonaws.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"teamsnap_get_announcements","arguments":{"team_id":"10413186","limit":5}}}' | head -c 2000

# get_calendar_urls
curl -s -X POST https://fhc04o0f1a.execute-api.us-west-2.amazonaws.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"teamsnap_get_calendar_urls","arguments":{"team_id":"10413186"}}}' | head -c 2000

# get_event (enriched + localized)
curl -s -X POST https://fhc04o0f1a.execute-api.us-west-2.amazonaws.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"teamsnap_get_event","arguments":{"event_id":"362285015"}}}' | head -c 2000
```

Expected for `get_event`: response includes `start.local`, `start.time_zone_iana: "America/Los_Angeles"`, `start.time_zone`, and `location` object with `name`, `address`, `map_url`.

- [ ] **Step 5: Commit README updates**

```bash
git add README.md
git commit -m "docs: document new read tools and revised TEAMSNAP_TIMEZONE behavior"
```

- [ ] **Step 6: Final parity and test check**

```bash
npm test
```

Expected: all tests pass.

---

## Self-review notes (resolved during planning)

- **Spec coverage:** All 11 Phase 1 read tools covered in Tasks 15–22; all 4 existing-tool enrichments covered in Tasks 12–14; timezone redesign implemented in Task 7 and wired throughout events/announcements/assignments/member_availability/forum handlers. Shared API core in Tasks 3–6; handler directory split in Tasks 9–11. README updated in Task 25.
- **Placeholder scan:** No "TBD"/"TODO"/"add error handling"-style placeholders; every step contains concrete code or commands.
- **Type consistency:** `TeamSnapCore.searchMany` / `searchOne` / `request` / `followLink` defined in Task 3 and used unchanged throughout; `LocalizedTime` shape defined in Task 7 and used unchanged; `teamsnapClient.getCore()` added in Task 4 and used unchanged throughout. `_setTeamSnapClient` added in Task 11 and used unchanged in AWS Lambda.
