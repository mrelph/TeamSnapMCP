# TeamSnap MCP — Phase 2: Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 write tools (availability, tracked items, events, messages, announcements) behind a `preview`/`confirm` safety model, with OAuth scope upgrade from `read` to `read write` and a clean re-authentication error path.

**Architecture:** Reuse Phase 1's shared `TeamSnapCore` by adding one new method, `core.write()`, that builds Collection+JSON templates and surfaces structured TeamSnap errors. Add a single `src/utils/writeSafety.ts` for preview/confirm/idempotency helpers. Distribute the 8 handlers across existing domain files (`events.ts`, `availability.ts`, `announcements.ts`, `assignments.ts`) rather than creating a new `writes.ts`, so write + read for a domain live together. Every write defaults `preview: true`; destructive writes (`send_announcement`, `update_event` with `is_canceled`) additionally require `confirm: true`.

**Tech Stack:** TypeScript (NodeNext modules), Node 18+, Vitest, esbuild (AWS bundle), TeamSnap Collection+JSON API, AWS Lambda + DynamoDB (no infra changes).

---

## Branch setup

Work on a new branch `phase2-writes` off `main` (after Phase 1 PR #2 merges). Do NOT touch `main` directly.

```bash
cd /mnt/c/Coding/TeamSnapMCP
git checkout main
git pull
git checkout -b phase2-writes
```

---

## Shared reference material

### TeamSnap Collection+JSON write payload format

All writes use the template pattern. POST body:

```json
{
  "template": {
    "data": [
      { "name": "team_id", "value": "123" },
      { "name": "subject", "value": "Practice cancelled" }
    ]
  }
}
```

PATCH body is identical. Response (2xx) echoes the updated resource as a normal Collection+JSON response with one item in `collection.items`. Error response (4xx/5xx) returns:

```json
{
  "collection": {
    "error": {
      "title": "Validation Failed",
      "message": "subject is required"
    }
  }
}
```

or plain text for 5xx. Code must handle both.

### Existing patterns to follow (from Phase 1)

- Every handler: `if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();` before API calls.
- Use `success({...})` / `error("...")` / `empty("not_found")` helpers from `common.ts`.
- Use `requireString(args, "event_id")` and `requireExactlyOne(args, [...])` for arg validation.
- Destructure allowlisted fields before returning — never leak `_href`/`_links`/`created_at`.
- Localize timestamps via `localizeTime(utcISO, eventTZ, eventTZLabel, { viewerTZ })` from `src/utils/time.ts`.

### File responsibilities

| File | Responsibility in Phase 2 |
|---|---|
| `src/api/core.ts` | +`write()` method, structured error extraction on 4xx |
| `src/api/endpoints.ts` | +write endpoints (non-`/search` base URLs + id-scoped paths) |
| `src/utils/writeSafety.ts` | NEW: `buildTemplate`, `checkIdempotency`, `storeIdempotency`, `requireConfirm` |
| `src/utils/config.ts` | `TEAMSNAP_SCOPES = "read write"` |
| `aws/src/lambda.ts` | `TEAMSNAP_SCOPES = "read write"` |
| `src/tools/handlers/availability.ts` | +`handleSetAvailability` |
| `src/tools/handlers/assignments.ts` | +`handleCreateTrackedItem`, `handleAssignTrackedItem`, `handleUpdateTrackedItemStatus` |
| `src/tools/handlers/events.ts` | +`handleCreateEvent`, `handleUpdateEvent` |
| `src/tools/handlers/announcements.ts` | +`handleSendTeamMessage`, `handleSendAnnouncement` |
| `src/tools/index.ts` | +8 tool definitions |
| `src/tools/handlers/index.ts` | +8 router cases |
| `tests/writeSafety.test.ts` | NEW: unit tests for all pure helpers |
| `README.md` | Updated tool table + re-auth documentation |

---

## Task 1: Add `write()` method and structured error extraction to `core.ts`

**Files:**
- Modify: `src/api/core.ts`
- Modify: `src/api/types.ts` (add error-response type)

This task adds the single new capability that all write handlers will use. The method accepts a method verb, endpoint, and a flat `{name: value}` record; it builds the Collection+JSON template, sends the request, and returns the first parsed item from the response.

Also improves the 4xx path in `request()`: if the body is JSON with `collection.error`, surface `title: message`; otherwise keep the existing plain-text fallback.

- [ ] **Step 1: Inspect the current `request()` error path**

Read `src/api/core.ts:59-62`. The current failure text is:

```ts
throw new Error(`TeamSnap API error (${response.status}): ${text}`);
```

Confirm the shape you need to preserve and what you're replacing.

- [ ] **Step 2: Add the error-shape type to `src/api/types.ts`**

Open `src/api/types.ts`. Add at the bottom:

```ts
export interface CollectionErrorResponse {
  collection: {
    error?: {
      title?: string;
      message?: string;
      code?: string;
    };
  };
}
```

- [ ] **Step 3: Update `request()` in `core.ts` to surface structured errors**

Open `src/api/core.ts`. Replace lines 59-62 with:

```ts
if (!response.ok) {
  const text = await response.text();
  let detail = text;
  try {
    const parsed = JSON.parse(text) as CollectionErrorResponse;
    const err = parsed.collection?.error;
    if (err?.title || err?.message) {
      detail = [err.title, err.message].filter(Boolean).join(": ");
    }
  } catch {
    // Non-JSON error body; keep raw text
  }
  throw new Error(`TeamSnap API error (${response.status}): ${detail}`);
}
```

Add the import at the top of `core.ts`:

```ts
import type { CollectionItem, CollectionResponse, Link, ParsedItem, CollectionErrorResponse } from "./types.js";
```

- [ ] **Step 4: Add the `write()` method to `TeamSnapCore`**

In the same file, after `followLink()` at line 82, add:

```ts
  async write(
    method: "POST" | "PATCH",
    endpoint: string,
    fields: Record<string, unknown>
  ): Promise<ParsedItem> {
    const template = {
      template: {
        data: Object.entries(fields).map(([name, value]) => ({ name, value })),
      },
    };
    const data = await this.request<CollectionResponse>(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });
    const first = data.collection.items?.[0];
    if (!first) {
      throw new Error(`Write to ${endpoint} succeeded (${method}) but returned no item`);
    }
    return parseCollectionItem(first);
  }
```

- [ ] **Step 5: Build and type-check**

```bash
cd /mnt/c/Coding/TeamSnapMCP
npm run build
```

Expected: no TypeScript errors. Output `dist/api/core.js` contains the new method.

- [ ] **Step 6: Commit**

```bash
git add src/api/core.ts src/api/types.ts
git commit -m "feat(core): add write() method and structured error extraction"
```

---

## Task 2: Add write endpoint constants to `endpoints.ts`

**Files:**
- Modify: `src/api/endpoints.ts`

TeamSnap writes target the collection root (POST) or an id-scoped resource (PATCH). Phase 1 only has the `/search` endpoints. Add what we need and nothing else — YAGNI.

- [ ] **Step 1: Extend `ENDPOINTS` in `src/api/endpoints.ts`**

Open `src/api/endpoints.ts`. Replace lines 4-36 (the existing `ENDPOINTS` object) with:

```ts
export const ENDPOINTS = {
  me: "/me",
  teams: "/teams/search",
  members: "/members/search",
  events: "/events/search",
  eventsBase: "/events",
  eventById: (id: string) => `/events/${id}`,
  availabilities: "/availabilities/search",
  availabilityById: (id: string) => `/availabilities/${id}`,
  locations: "/locations/search",
  locationById: (id: string) => `/locations/${id}`,
  memberEmails: "/member_email_addresses/search",
  memberPhones: "/member_phone_numbers/search",
  memberPhotos: "/member_photos/search",
  contacts: "/contacts/search",
  contactEmails: "/contact_email_addresses/search",
  contactPhones: "/contact_phone_numbers/search",
  broadcastEmails: "/broadcast_emails/search",
  broadcastEmailsBase: "/broadcast_emails",
  broadcastAlerts: "/broadcast_alerts/search",
  broadcastAlertsBase: "/broadcast_alerts",
  messages: "/messages/search",
  messagesBase: "/messages",
  trackedItems: "/tracked_items/search",
  trackedItemsBase: "/tracked_items",
  trackedItemStatuses: "/tracked_item_statuses/search",
  trackedItemStatusById: (id: string) => `/tracked_item_statuses/${id}`,
  assignments: "/assignments/search",
  assignmentsBase: "/assignments",
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
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/endpoints.ts
git commit -m "feat(endpoints): add write endpoints for events, availability, tracked items, announcements"
```

---

## Task 3: Create `src/utils/writeSafety.ts` with unit tests

**Files:**
- Create: `src/utils/writeSafety.ts`
- Create: `tests/writeSafety.test.ts`

Single utility module for write safety rails. Exposes pure functions so unit tests don't need network.

- [ ] **Step 1: Write failing tests**

Create `tests/writeSafety.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildTemplate,
  checkIdempotency,
  storeIdempotency,
  requireConfirm,
  __clearIdempotencyCache,
} from "../src/utils/writeSafety.js";

describe("buildTemplate", () => {
  it("produces Collection+JSON template from flat fields", () => {
    const t = buildTemplate({ subject: "Hi", body: "There", recipient_count: 5 });
    expect(t).toEqual({
      template: {
        data: [
          { name: "subject", value: "Hi" },
          { name: "body", value: "There" },
          { name: "recipient_count", value: 5 },
        ],
      },
    });
  });

  it("omits fields whose value is undefined", () => {
    const t = buildTemplate({ a: "x", b: undefined, c: null });
    expect(t.template.data).toEqual([
      { name: "a", value: "x" },
      { name: "c", value: null },
    ]);
  });

  it("preserves false, 0, and empty string", () => {
    const t = buildTemplate({ flag: false, count: 0, note: "" });
    expect(t.template.data).toEqual([
      { name: "flag", value: false },
      { name: "count", value: 0 },
      { name: "note", value: "" },
    ]);
  });
});

describe("idempotency cache", () => {
  beforeEach(() => {
    __clearIdempotencyCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for unknown key", () => {
    expect(checkIdempotency("key-a")).toBeNull();
  });

  it("returns null when key is undefined", () => {
    expect(checkIdempotency(undefined)).toBeNull();
  });

  it("returns stored value within TTL", () => {
    storeIdempotency("key-a", { ok: true });
    expect(checkIdempotency("key-a")).toEqual({ ok: true });
  });

  it("expires after 60 seconds", () => {
    storeIdempotency("key-a", { ok: true });
    vi.advanceTimersByTime(59_000);
    expect(checkIdempotency("key-a")).toEqual({ ok: true });
    vi.advanceTimersByTime(2_000);
    expect(checkIdempotency("key-a")).toBeNull();
  });

  it("storeIdempotency is a no-op when key is undefined", () => {
    storeIdempotency(undefined, { ok: true });
    expect(checkIdempotency(undefined)).toBeNull();
  });
});

describe("requireConfirm", () => {
  it("returns ok=true when confirm is true", () => {
    expect(requireConfirm({ confirm: true })).toEqual({ ok: true });
  });

  it("returns ok=false with reason when confirm is missing", () => {
    const r = requireConfirm({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("confirm: true");
  });

  it("returns ok=false when confirm is false", () => {
    const r = requireConfirm({ confirm: false });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when confirm is a non-boolean truthy value", () => {
    const r = requireConfirm({ confirm: "yes" });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /mnt/c/Coding/TeamSnapMCP
npx vitest run tests/writeSafety.test.ts
```

Expected: FAIL — module `../src/utils/writeSafety.js` not found.

- [ ] **Step 3: Create `src/utils/writeSafety.ts`**

```ts
export interface CollectionJsonTemplate {
  template: { data: Array<{ name: string; value: unknown }> };
}

export function buildTemplate(fields: Record<string, unknown>): CollectionJsonTemplate {
  const data: Array<{ name: string; value: unknown }> = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    data.push({ name, value });
  }
  return { template: { data } };
}

const IDEMPOTENCY_TTL_MS = 60_000;
const idempotencyCache = new Map<string, { result: unknown; expiresAt: number }>();

export function checkIdempotency(key: string | undefined): unknown | null {
  if (!key) return null;
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry.result;
}

export function storeIdempotency(key: string | undefined, result: unknown): void {
  if (!key) return;
  idempotencyCache.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

export function __clearIdempotencyCache(): void {
  idempotencyCache.clear();
}

export type ConfirmCheck = { ok: true } | { ok: false; reason: string };

export function requireConfirm(args: { confirm?: unknown }): ConfirmCheck {
  if (args.confirm === true) return { ok: true };
  return {
    ok: false,
    reason:
      "This is a destructive action. Pass confirm: true to proceed. Run the tool once with preview: true (default) to inspect the payload first.",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/writeSafety.test.ts
```

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/writeSafety.ts tests/writeSafety.test.ts
git commit -m "feat(writeSafety): add buildTemplate, idempotency cache, and confirm helpers"
```

---

## Task 4: Change OAuth scope to `read write`

**Files:**
- Modify: `src/utils/config.ts:19`
- Modify: `aws/src/lambda.ts:32`

The change is additive: TeamSnap issues a new token with both scopes on next auth. Existing read-only tokens keep working for reads (no visible change). The first write attempt with an old token triggers a 401 that the existing `request()` retry-once path converts into `reauthentication_required`.

- [ ] **Step 1: Update `src/utils/config.ts:19`**

Change:

```ts
export const TEAMSNAP_SCOPES = "read";
```

to:

```ts
export const TEAMSNAP_SCOPES = "read write";
```

- [ ] **Step 2: Update `aws/src/lambda.ts:32`**

Change:

```ts
const TEAMSNAP_SCOPES = "read";
```

to:

```ts
const TEAMSNAP_SCOPES = "read write";
```

- [ ] **Step 3: Update `core.ts` 401-after-refresh error message**

Open `src/api/core.ts`. Find line 56:

```ts
throw new Error("Session expired. Please re-authenticate with teamsnap_auth.");
```

Replace with:

```ts
throw new Error("reauthentication_required: Your TeamSnap session is invalid or lacks the required scope. Please run teamsnap_auth to reconnect.");
```

- [ ] **Step 4: Build both targets**

```bash
cd /mnt/c/Coding/TeamSnapMCP
npm run build
cd aws && npm run build && cd ..
```

Expected: no errors. `dist/utils/config.js` and `aws/dist/lambda.js` both contain `read write`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/config.ts aws/src/lambda.ts src/api/core.ts
git commit -m "feat(auth): request read+write OAuth scope; clearer reauth error on 401"
```

---

## Task 5: `teamsnap_set_availability` (simplest write: PATCH existing record)

**Files:**
- Modify: `src/tools/handlers/availability.ts`
- Modify: `src/api/client.ts` (facade helper if needed — use `core.write` directly instead)

This is the first write tool on purpose: PATCH of an existing record, fully owned by the user, no confirm required, no side effects beyond the user's own RSVP. Pattern sets the precedent for the rest.

Flow:
1. Validate `event_id`, `member_id`, `status`.
2. Fetch existing availability for that event+member to get its id.
3. If `preview: true`, return `{ would_patch: availability_id, with: {status_code, notes} }`.
4. Otherwise `core.write("PATCH", /availabilities/:id, {status_code, notes})` and return the updated record.

Mapping `status` string → `status_code` number:
- `"yes"` → `1`
- `"no"` → `0`
- `"maybe"` → `2`

- [ ] **Step 1: Add `handleSetAvailability` to `src/tools/handlers/availability.ts`**

Append after the existing `handleGetAvailability` (end of file):

```ts
import { ENDPOINTS } from "../../api/endpoints.js";

const STATUS_TO_CODE: Record<string, number> = { yes: 1, no: 0, maybe: 2 };

export async function handleSetAvailability(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  const memberId = requireString(args, "member_id");
  const status = requireString(args, "status").toLowerCase();
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  const preview = args.preview !== false;

  if (!(status in STATUS_TO_CODE)) {
    return error(`status must be one of: yes, no, maybe (got "${status}")`);
  }
  const statusCode = STATUS_TO_CODE[status];

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const existing = await core.searchOne(
      `${ENDPOINTS.availabilities}?event_id=${eventId}&member_id=${memberId}`
    );
    if (!existing?.id) {
      return error(`No availability record found for event_id=${eventId}, member_id=${memberId}`);
    }
    const availabilityId = String(existing.id);
    const fields: Record<string, unknown> = { status_code: statusCode };
    if (notes !== undefined) fields.notes = notes;

    if (preview) {
      return success({
        preview: true,
        would_patch: `availability ${availabilityId}`,
        event_id: eventId,
        member_id: memberId,
        with: { status, status_code: statusCode, notes: notes ?? null },
      });
    }

    const updated = await core.write("PATCH", ENDPOINTS.availabilityById(availabilityId), fields);
    return success({
      status_code: updated.status_code,
      status,
      event_id: eventId,
      member_id: memberId,
      notes: updated.notes ?? null,
    });
  } catch (err) {
    return error(`Failed to set availability: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

Also add the missing imports if not already present. Current imports at top of file:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { success, error, requireString, type ToolArgs } from "./common.js";
```

No new imports needed for `common.ts` helpers beyond what's there. `ENDPOINTS` import is already added above.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/availability.ts
git commit -m "feat(writes): add teamsnap_set_availability (PATCH availabilities/:id)"
```

---

## Task 6: `teamsnap_update_tracked_item_status` (PATCH)

**Files:**
- Modify: `src/tools/handlers/assignments.ts`

PATCH semantics mirror set_availability: record already exists, user updates their own status. Maps string status → TeamSnap's internal representation. TeamSnap uses distinct fields for the three states:
- `"pending"` → clear `claimed_at` and `completed_at` (set both to `null`)
- `"claimed"` → set `claimed_at` to current ISO time, clear `completed_at`
- `"complete"` → set `completed_at` to current ISO time (leave `claimed_at` as-is)

This matches the semantics surfaced by `get_assignments` in Phase 1 (`assignments.ts` resolves status from the presence of those two fields).

- [ ] **Step 1: Add `handleUpdateTrackedItemStatus` to `src/tools/handlers/assignments.ts`**

First, inspect existing imports at the top of `src/tools/handlers/assignments.ts`. Ensure the file has:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import {
  success,
  error,
  requireString,
  requireExactlyOne,
  type ToolArgs,
} from "./common.js";
```

Append at the end of the file:

```ts
const TRACKED_STATUS_VALID = ["pending", "claimed", "complete"] as const;
type TrackedStatus = (typeof TRACKED_STATUS_VALID)[number];

function buildStatusFields(status: TrackedStatus, notes?: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {};
  if (status === "pending") {
    fields.claimed_at = null;
    fields.completed_at = null;
  } else if (status === "claimed") {
    fields.claimed_at = now;
    fields.completed_at = null;
  } else {
    fields.completed_at = now;
  }
  if (notes !== undefined) fields.notes = notes;
  return fields;
}

export async function handleUpdateTrackedItemStatus(args: ToolArgs): Promise<CallToolResult> {
  const statusId = requireString(args, "tracked_item_status_id");
  const status = requireString(args, "status").toLowerCase() as TrackedStatus;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  const preview = args.preview !== false;

  if (!TRACKED_STATUS_VALID.includes(status)) {
    return error(`status must be one of: ${TRACKED_STATUS_VALID.join(", ")} (got "${status}")`);
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const fields = buildStatusFields(status, notes);

    if (preview) {
      return success({
        preview: true,
        would_patch: `tracked_item_status ${statusId}`,
        with: { status, ...fields },
      });
    }

    const updated = await core.write(
      "PATCH",
      ENDPOINTS.trackedItemStatusById(statusId),
      fields
    );
    return success({
      id: updated.id,
      tracked_item_id: updated.tracked_item_id,
      member_id: updated.member_id,
      status,
      claimed_at: updated.claimed_at ?? null,
      completed_at: updated.completed_at ?? null,
      notes: updated.notes ?? null,
    });
  } catch (err) {
    return error(`Failed to update tracked item status: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/assignments.ts
git commit -m "feat(writes): add teamsnap_update_tracked_item_status"
```

---

## Task 7: `teamsnap_create_tracked_item` (POST with optional idempotency)

**Files:**
- Modify: `src/tools/handlers/assignments.ts`

First POST tool. Creates a new tracked item (snack sign-up, carpool slot, etc). Optional `event_id` attaches it to an event; otherwise it's team-wide. Preview shows the full template; real POST returns the created item.

- [ ] **Step 1: Add `handleCreateTrackedItem`**

Append to `src/tools/handlers/assignments.ts`:

```ts
import { buildTemplate, checkIdempotency, storeIdempotency } from "../../utils/writeSafety.js";

export async function handleCreateTrackedItem(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const name = requireString(args, "name");
  const eventId = typeof args.event_id === "string" ? args.event_id : undefined;
  const dueDate = typeof args.due_date === "string" ? args.due_date : undefined;
  const description = typeof args.description === "string" ? args.description : undefined;
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = { team_id: teamId, name };
  if (eventId !== undefined) fields.event_id = eventId;
  if (dueDate !== undefined) fields.due_date = dueDate;
  if (description !== undefined) fields.description = description;

  if (preview) {
    return success({
      preview: true,
      would_post: "tracked_items",
      template: buildTemplate(fields).template,
    });
  }

  const cached = checkIdempotency(idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.trackedItemsBase, fields);
    const result = {
      id: created.id,
      team_id: created.team_id,
      event_id: created.event_id ?? null,
      name: created.name,
      due_date: created.due_date ?? null,
      description: created.description ?? null,
    };
    storeIdempotency(idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to create tracked item: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/assignments.ts
git commit -m "feat(writes): add teamsnap_create_tracked_item (POST with idempotency)"
```

---

## Task 8: `teamsnap_assign_tracked_item` (POST assignment, dependency on existing tracked item)

**Files:**
- Modify: `src/tools/handlers/assignments.ts`

Creates an assignment linking a tracked item to a member. POST /assignments. Same safety pattern as create_tracked_item.

- [ ] **Step 1: Add `handleAssignTrackedItem`**

Append to `src/tools/handlers/assignments.ts`:

```ts
export async function handleAssignTrackedItem(args: ToolArgs): Promise<CallToolResult> {
  const trackedItemId = requireString(args, "tracked_item_id");
  const memberId = requireString(args, "member_id");
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = {
    tracked_item_id: trackedItemId,
    member_id: memberId,
  };

  if (preview) {
    return success({
      preview: true,
      would_post: "assignments",
      template: buildTemplate(fields).template,
    });
  }

  const cached = checkIdempotency(idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.assignmentsBase, fields);
    const result = {
      id: created.id,
      tracked_item_id: created.tracked_item_id,
      member_id: created.member_id,
    };
    storeIdempotency(idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to assign tracked item: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/assignments.ts
git commit -m "feat(writes): add teamsnap_assign_tracked_item"
```

---

## Task 9: `teamsnap_create_event` (POST event with rich fields)

**Files:**
- Modify: `src/tools/handlers/events.ts`

POST /events. Accepts the coach-facing field set (name, start, duration, location, opponent, notes, uniform, arrival). Returns the created event with localized times so Claude can confirm.

- [ ] **Step 1: Add `handleCreateEvent` to `src/tools/handlers/events.ts`**

Append to the end of `src/tools/handlers/events.ts`:

```ts
import { buildTemplate, checkIdempotency, storeIdempotency } from "../../utils/writeSafety.js";

export async function handleCreateEvent(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const name = requireString(args, "name");
  const startDate = requireString(args, "start_date");
  const isGame = typeof args.is_game === "boolean" ? args.is_game : false;
  const durationMinutes = typeof args.duration_in_minutes === "number" ? args.duration_in_minutes : undefined;
  const locationId = typeof args.location_id === "string" ? args.location_id : undefined;
  const opponentId = typeof args.opponent_id === "string" ? args.opponent_id : undefined;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  const uniform = typeof args.uniform === "string" ? args.uniform : undefined;
  const arrivalMinutesEarly = typeof args.arrival_minutes_early === "number" ? args.arrival_minutes_early : undefined;
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = {
    team_id: teamId,
    name,
    start_date: startDate,
    is_game: isGame,
  };
  if (durationMinutes !== undefined) fields.duration_in_minutes = durationMinutes;
  if (locationId !== undefined) fields.location_id = locationId;
  if (opponentId !== undefined) fields.opponent_id = opponentId;
  if (notes !== undefined) fields.notes = notes;
  if (uniform !== undefined) fields.uniform = uniform;
  if (arrivalMinutesEarly !== undefined) fields.minutes_to_arrive_early = arrivalMinutesEarly;

  if (preview) {
    return success({
      preview: true,
      would_post: "events",
      template: buildTemplate(fields).template,
    });
  }

  const cached = checkIdempotency(idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.eventsBase, fields);
    const picked = pickEventFields(created);
    const viewerTZ = getViewerTZ();
    const localized = localizeEventTimes(picked as EventLike, { viewerTZ });
    storeIdempotency(idempotencyKey, localized);
    return success(localized);
  } catch (err) {
    return error(`Failed to create event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/events.ts
git commit -m "feat(writes): add teamsnap_create_event"
```

---

## Task 10: `teamsnap_update_event` (PATCH with confirm-on-cancel)

**Files:**
- Modify: `src/tools/handlers/events.ts`

PATCH /events/:id. Accepts an optional `patch` object. If the patch contains `is_canceled: true`, require `confirm: true` — cancelling an event notifies the whole team. Other updates (rename, reschedule, change location) are non-destructive.

Preview returns the payload regardless of confirm state so coaches can inspect before committing.

- [ ] **Step 1: Add `handleUpdateEvent`**

Append to `src/tools/handlers/events.ts`:

```ts
import { requireConfirm } from "../../utils/writeSafety.js";

const EVENT_PATCH_ALLOWED = [
  "name",
  "start_date",
  "location_id",
  "duration_in_minutes",
  "notes",
  "uniform",
  "is_canceled",
  "opponent_id",
  "minutes_to_arrive_early",
] as const;

export async function handleUpdateEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  const patchArg = args.patch;
  const preview = args.preview !== false;

  if (!patchArg || typeof patchArg !== "object") {
    return error("patch (object) is required — e.g. { name: 'New name', start_date: '2026-06-14T19:00:00Z' }");
  }
  const patch = patchArg as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return error("patch must contain at least one field");
  }
  const unknown = keys.filter((k) => !(EVENT_PATCH_ALLOWED as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return error(`patch contains unsupported fields: ${unknown.join(", ")}. Allowed: ${EVENT_PATCH_ALLOWED.join(", ")}`);
  }

  const cancelling = patch.is_canceled === true;
  if (!preview && cancelling) {
    const check = requireConfirm(args);
    if (!check.ok) {
      return success({
        preview: true,
        would_patch: `events/${eventId}`,
        with: patch,
        warning: "Cancelling this event notifies the team.",
        blocked: check.reason,
      });
    }
  }

  if (preview) {
    return success({
      preview: true,
      would_patch: `events/${eventId}`,
      with: patch,
      warning: cancelling ? "Cancelling this event notifies the team. Pass confirm: true to send." : undefined,
    });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const updated = await core.write("PATCH", ENDPOINTS.eventById(eventId), patch);
    const picked = pickEventFields(updated);
    const viewerTZ = getViewerTZ();
    const localized = localizeEventTimes(picked as EventLike, { viewerTZ });
    return success(localized);
  } catch (err) {
    return error(`Failed to update event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/events.ts
git commit -m "feat(writes): add teamsnap_update_event with confirm-on-cancel"
```

---

## Task 11: `teamsnap_send_team_message` (POST messages, in-app only)

**Files:**
- Modify: `src/tools/handlers/announcements.ts`

In-app messages post to `/messages`. These are inside-app notifications only (not email, not SMS) so no `confirm` gate is required. Preview still defaults true.

- [ ] **Step 1: Add `handleSendTeamMessage`**

Append to `src/tools/handlers/announcements.ts`:

```ts
import { buildTemplate, checkIdempotency, storeIdempotency } from "../../utils/writeSafety.js";

export async function handleSendTeamMessage(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const body = requireString(args, "body");
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = {
    team_id: teamId,
    message: body,
  };

  if (preview) {
    return success({
      preview: true,
      would_post: "messages",
      template: buildTemplate(fields).template,
    });
  }

  const cached = checkIdempotency(idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.messagesBase, fields);
    const result = {
      id: created.id,
      team_id: created.team_id,
      sender_id: created.member_id ?? created.sender_id ?? null,
      body: created.message ?? created.body ?? body,
      sent_at: created.created_at ?? null,
    };
    storeIdempotency(idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to send team message: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/announcements.ts
git commit -m "feat(writes): add teamsnap_send_team_message"
```

---

## Task 12: `teamsnap_send_announcement` (POST broadcast, requires confirm)

**Files:**
- Modify: `src/tools/handlers/announcements.ts`

Most destructive write. Sends email or push-alert to every recipient. `channel: "email" | "alert"` picks the endpoint. Recipients default to the whole team; optional `recipient_member_ids: string[]` narrows it. **Always requires `confirm: true`.**

- [ ] **Step 1: Add `handleSendAnnouncement`**

Append to `src/tools/handlers/announcements.ts`:

```ts
import { requireConfirm } from "../../utils/writeSafety.js";

export async function handleSendAnnouncement(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const channel = requireString(args, "channel").toLowerCase();
  const subject = requireString(args, "subject");
  const body = requireString(args, "body");
  const recipientIds = Array.isArray(args.recipient_member_ids)
    ? (args.recipient_member_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  if (channel !== "email" && channel !== "alert") {
    return error(`channel must be "email" or "alert" (got "${channel}")`);
  }

  const endpoint = channel === "email" ? ENDPOINTS.broadcastEmailsBase : ENDPOINTS.broadcastAlertsBase;
  const fields: Record<string, unknown> = {
    team_id: teamId,
    subject,
    body,
  };
  if (recipientIds && recipientIds.length > 0) {
    fields.recipient_ids = recipientIds;
  }

  if (preview) {
    return success({
      preview: true,
      would_post: endpoint.replace(/^\//, ""),
      recipients: recipientIds ? `${recipientIds.length} specific members` : "entire team",
      template: buildTemplate(fields).template,
      warning: "This will send a real email/alert to recipients. Pass confirm: true to send.",
    });
  }

  const check = requireConfirm(args);
  if (!check.ok) {
    return success({
      preview: true,
      would_post: endpoint.replace(/^\//, ""),
      recipients: recipientIds ? `${recipientIds.length} specific members` : "entire team",
      template: buildTemplate(fields).template,
      blocked: check.reason,
    });
  }

  const cached = checkIdempotency(idempotencyKey);
  if (cached) {
    return success({ idempotent_replay: true, result: cached });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", endpoint, fields);
    const result = {
      id: created.id,
      type: channel,
      team_id: created.team_id,
      subject: created.subject ?? subject,
      body: created.body ?? body,
      sent_at: created.created_at ?? null,
      recipient_count: recipientIds?.length ?? null,
    };
    storeIdempotency(idempotencyKey, result);
    return success(result);
  } catch (err) {
    return error(`Failed to send announcement: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/handlers/announcements.ts
git commit -m "feat(writes): add teamsnap_send_announcement (email/alert, requires confirm)"
```

---

## Task 13: Register 8 new tools in `src/tools/index.ts`

**Files:**
- Modify: `src/tools/index.ts`

Add tool definitions in the same order as the spec table. Keep descriptions coach-friendly. Every write tool includes `preview` in its schema; destructive ones include `confirm`; POST tools include `idempotency_key`.

- [ ] **Step 1: Open `src/tools/index.ts` and append 8 new entries**

Locate the closing `];` at the end of the `tools` array. Before that line, insert the following 8 tool definitions:

```ts
  {
    name: "teamsnap_set_availability",
    description:
      "Set a member's RSVP for an event. Patches the existing availability record. Preview by default; pass preview: false to commit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Event to RSVP to" },
        member_id: { type: "string", description: "Member whose RSVP is being set" },
        status: { type: "string", enum: ["yes", "no", "maybe"], description: "RSVP status" },
        notes: { type: "string", description: "Optional note attached to the RSVP" },
        preview: { type: "boolean", description: "If true (default), return the payload without patching" },
      },
      required: ["event_id", "member_id", "status"],
    },
  },
  {
    name: "teamsnap_update_tracked_item_status",
    description:
      "Update a tracked-item status (snack sign-up, carpool, etc.) to pending, claimed, or complete. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tracked_item_status_id: { type: "string", description: "Tracked item status record id" },
        status: { type: "string", enum: ["pending", "claimed", "complete"] },
        notes: { type: "string", description: "Optional note" },
        preview: { type: "boolean", description: "If true (default), return the payload without patching" },
      },
      required: ["tracked_item_status_id", "status"],
    },
  },
  {
    name: "teamsnap_create_tracked_item",
    description:
      "Create a new tracked item (snack sign-up, carpool, etc.) for a team or event. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        name: { type: "string", description: "Short label, e.g. 'Snacks'" },
        event_id: { type: "string", description: "Optional: attach to a single event" },
        due_date: { type: "string", description: "Optional ISO 8601" },
        description: { type: "string" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["team_id", "name"],
    },
  },
  {
    name: "teamsnap_assign_tracked_item",
    description: "Assign a tracked item to a team member. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tracked_item_id: { type: "string" },
        member_id: { type: "string" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["tracked_item_id", "member_id"],
    },
  },
  {
    name: "teamsnap_create_event",
    description:
      "Create a new event (game, practice, meeting). Returns the created event with localized times. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        name: { type: "string" },
        is_game: { type: "boolean", description: "Game vs practice/other" },
        start_date: { type: "string", description: "ISO 8601 UTC start time" },
        duration_in_minutes: { type: "number" },
        location_id: { type: "string" },
        opponent_id: { type: "string", description: "For games" },
        notes: { type: "string" },
        uniform: { type: "string" },
        arrival_minutes_early: { type: "number" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["team_id", "name", "start_date"],
    },
  },
  {
    name: "teamsnap_update_event",
    description:
      "Update an existing event via a patch object. Non-destructive fields (name, start_date, location_id, duration_in_minutes, notes, uniform, opponent_id, minutes_to_arrive_early) update freely. Setting is_canceled: true requires confirm: true because it notifies the team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string" },
        patch: {
          type: "object",
          description:
            "Object of fields to update. Supported keys: name, start_date, location_id, duration_in_minutes, notes, uniform, opponent_id, minutes_to_arrive_early, is_canceled.",
        },
        preview: { type: "boolean", description: "If true (default), return the payload without patching" },
        confirm: { type: "boolean", description: "Required when patch.is_canceled is true" },
      },
      required: ["event_id", "patch"],
    },
  },
  {
    name: "teamsnap_send_team_message",
    description:
      "Post an in-app message to the team's message board. No emails or push notifications are sent. Preview by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        body: { type: "string", description: "Message body" },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without posting" },
      },
      required: ["team_id", "body"],
    },
  },
  {
    name: "teamsnap_send_announcement",
    description:
      "Send a broadcast email or push alert to the team (or a subset of members). Real emails/alerts are sent. Preview by default; always requires confirm: true to actually send.",
    inputSchema: {
      type: "object" as const,
      properties: {
        team_id: { type: "string" },
        channel: { type: "string", enum: ["email", "alert"], description: "Delivery channel" },
        subject: { type: "string" },
        body: { type: "string" },
        recipient_member_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional: specific members (default: whole team)",
        },
        idempotency_key: { type: "string", description: "Optional 60s dedup key" },
        preview: { type: "boolean", description: "If true (default), return the payload without sending" },
        confirm: { type: "boolean", description: "Required to actually send" },
      },
      required: ["team_id", "channel", "subject", "body"],
    },
  },
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(tools): register 8 new write tools"
```

---

## Task 14: Wire 8 new handlers into router

**Files:**
- Modify: `src/tools/handlers/index.ts`

- [ ] **Step 1: Extend imports and switch cases**

Open `src/tools/handlers/index.ts`. Update the imports at the top to include the new handler exports:

```ts
import { handleGetAvailability, handleSetAvailability } from "./availability.js";
import {
  handleGetAssignments,
  handleCreateTrackedItem,
  handleAssignTrackedItem,
  handleUpdateTrackedItemStatus,
} from "./assignments.js";
import {
  handleGetEvents,
  handleGetEvent,
  handleGetLocation,
  handleCreateEvent,
  handleUpdateEvent,
} from "./events.js";
import {
  handleGetAnnouncements,
  handleSendTeamMessage,
  handleSendAnnouncement,
} from "./announcements.js";
```

(Replace the three existing import lines for availability, assignments, events, announcements — leave the other handler imports untouched.)

Inside the `switch (name)` block, before the `default:` case, add:

```ts
      case "teamsnap_set_availability":
        return handleSetAvailability(args);
      case "teamsnap_update_tracked_item_status":
        return handleUpdateTrackedItemStatus(args);
      case "teamsnap_create_tracked_item":
        return handleCreateTrackedItem(args);
      case "teamsnap_assign_tracked_item":
        return handleAssignTrackedItem(args);
      case "teamsnap_create_event":
        return handleCreateEvent(args);
      case "teamsnap_update_event":
        return handleUpdateEvent(args);
      case "teamsnap_send_team_message":
        return handleSendTeamMessage(args);
      case "teamsnap_send_announcement":
        return handleSendAnnouncement(args);
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors. If any handler name doesn't match its export, fix the import.

- [ ] **Step 3: Verify tool count**

Run a quick count to confirm all 29 tools are wired (3 auth + 1 list + 17 reads + 8 writes):

```bash
grep -c "^      case " src/tools/handlers/index.ts
```

Expected: `29`.

- [ ] **Step 4: Commit**

```bash
git add src/tools/handlers/index.ts
git commit -m "feat(router): wire 8 new write tools"
```

---

## Task 15: Update README with new tools and re-auth documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Extend the Available Tools table**

Open `README.md`. Locate the `## Available Tools` section (starts around line 132). Add these rows at the end of the existing table (after `teamsnap_get_custom_data`), keeping the same three-column layout (`Tool | Description | Required args`):

```markdown
| `teamsnap_set_availability` | Set a member's RSVP for an event (preview by default) | `event_id`, `member_id`, `status` |
| `teamsnap_update_tracked_item_status` | Update a tracked-item status (preview by default) | `tracked_item_status_id`, `status` |
| `teamsnap_create_tracked_item` | Create a snack/volunteer/carpool tracked item (preview by default) | `team_id`, `name` |
| `teamsnap_assign_tracked_item` | Assign a tracked item to a member (preview by default) | `tracked_item_id`, `member_id` |
| `teamsnap_create_event` | Create a new event (preview by default) | `team_id`, `name`, `start_date` |
| `teamsnap_update_event` | Update or cancel an event; confirm required for cancel | `event_id`, `patch` |
| `teamsnap_send_team_message` | Post an in-app team message (preview by default) | `team_id`, `body` |
| `teamsnap_send_announcement` | Send an email/alert broadcast; confirm required to send | `team_id`, `channel`, `subject`, `body` |
```

- [ ] **Step 2: Add a new "Write Tools & Safety" section before "Example Prompts"**

Locate the line `## Example Prompts` and insert before it:

```markdown
## Write Tools & Safety

Phase 2 added 8 write tools that can modify TeamSnap data. They follow consistent safety rails:

- **`preview: true` by default.** Every write tool returns the payload it *would* send without actually calling TeamSnap, so you can inspect first. Pass `preview: false` to commit.
- **`confirm: true` for destructive actions.** `teamsnap_send_announcement` always requires it; `teamsnap_update_event` requires it only when the patch sets `is_canceled: true`.
- **`idempotency_key` for POST tools.** Optional 60-second in-memory dedup cache keyed on the value you supply. Best-effort on Lambda (short function lifetime).
- **Re-authentication.** If you authenticated before Phase 2, your existing token has `read` scope only. Your first write will return `reauthentication_required` — just run `teamsnap_auth` again to get a `read write` token. Reads continue to work throughout.

### Example: preview → commit flow

```
You: "RSVP Mark as 'yes' for event 12345"
Claude (calls teamsnap_set_availability with defaults):
  { preview: true, would_patch: "availability 987", with: { status: "yes", status_code: 1, notes: null } }
You: "Looks right, do it"
Claude (calls teamsnap_set_availability with preview: false):
  { status: "yes", event_id: 12345, member_id: 67890, notes: null }
```
```

- [ ] **Step 3: Update the Environment Variables section if scope-related**

No env var changes needed — `TEAMSNAP_SCOPES` is a compile-time constant.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document 8 write tools and preview/confirm/reauth safety model"
```

---

## Task 16: Rebuild AWS Lambda bundle and verify scope in build output

**Files:**
- Modify: `aws/dist/lambda.js` (built artifact — not committed)

- [ ] **Step 1: Build the AWS bundle**

```bash
cd /mnt/c/Coding/TeamSnapMCP/aws
npm run build
cd ..
```

Expected: esbuild reports `dist/lambda.js` size (~75kb range with 8 new handlers bundled).

- [ ] **Step 2: Verify the scope string made it into the bundle**

```bash
grep -c "read write" aws/dist/lambda.js
```

Expected: `1` (the Lambda's own scope constant). If `0`, the build didn't pick up the source change — re-run `cd aws && npm run build`.

- [ ] **Step 3: Verify all 29 tool names are in the bundle**

```bash
grep -c "teamsnap_" aws/dist/lambda.js
```

Expected: at least `29` (tool names + a few internal references). If significantly lower, check that `src/tools/index.ts` got picked up.

- [ ] **Step 4: Commit the bundle**

```bash
git add aws/dist/lambda.js
git commit -m "build: rebuild AWS Lambda bundle with Phase 2 writes"
```

---

## Task 17: Deploy to AWS us-east-1 and run smoke tests

**Stop here and ask the user before deploying.** Deploy is a cross-region production action.

When the user confirms, run:

- [ ] **Step 1: Deploy**

```bash
cd /mnt/c/Coding/TeamSnapMCP/aws
AWS_REGION=us-east-1 \
  TEAMSNAP_CLIENT_ID="<ask user>" \
  TEAMSNAP_CLIENT_SECRET="<ask user>" \
  node scripts/deploy.cjs
```

Expected: "Deployment complete!" with endpoint `https://svu4xwvh74.execute-api.us-east-1.amazonaws.com`.

- [ ] **Step 2: Smoke-test /health**

```bash
curl -s https://svu4xwvh74.execute-api.us-east-1.amazonaws.com/health
```

Expected: `{"status":"ok","service":"teamsnap-mcp"}`.

- [ ] **Step 3: Smoke-test preview writes (no real API call to TeamSnap)**

Preview tests do not require the user to re-authenticate. Ask the user to run in Claude:

1. "Preview setting my RSVP to yes for event <any recent event id>" → expect a `preview: true` response with `would_patch`.
2. "Preview sending a team message saying 'Test, ignore'" → expect `preview: true` with the `messages` template.
3. "Preview sending an announcement to the team, subject 'Test', body 'Ignore', channel 'alert'" → expect `preview: true` + `blocked: "... confirm: true ..."` because `confirm` is not set.

- [ ] **Step 4: User re-authenticates**

Ask the user to run `teamsnap_auth` in Claude. The auth URL in the response will request `scope=read write`. After completing the flow, `teamsnap_auth_status` should confirm.

- [ ] **Step 5: Single live write smoke test**

Ask the user to pick a low-stakes target (e.g. set their own RSVP for a real event) and run it with `preview: false`. Verify it took effect in the TeamSnap web UI.

- [ ] **Step 6: Open the PR**

```bash
cd /mnt/c/Coding/TeamSnapMCP
git push -u origin phase2-writes
gh pr create --title "Phase 2: 8 write tools + OAuth read+write scope" --body "$(cat <<'EOF'
## Summary
- Add 8 write tools across availability, tracked items, events, messages, and announcements
- All writes default to `preview: true`; destructive writes require `confirm: true`
- Upgrade OAuth scope to `read write`; clear `reauthentication_required` error for old tokens
- New `TeamSnapCore.write()` method builds Collection+JSON templates and surfaces structured TeamSnap errors
- New `src/utils/writeSafety.ts` with `buildTemplate`, `checkIdempotency`, `storeIdempotency`, `requireConfirm` (all unit-tested)

## Test plan
- [x] `npx vitest run` — writeSafety tests green
- [x] `npm run build` (root + `aws/`) — clean
- [x] AWS deploy to us-east-1, `/health` green
- [x] Preview-mode smoke tests for 3 representative tools (set_availability, send_team_message, send_announcement)
- [x] OAuth re-auth flow produces `read write` scope token
- [x] One live write end-to-end (low-stakes)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Cross-checking the plan against the spec:

**Spec coverage:**
- OAuth scope `read` → `read write`: Task 4 ✅
- `reauthentication_required` error on 401: Task 4 (core.ts message update) ✅
- 8 write tools: Tasks 5–12 ✅
- `preview: true` default: in every handler ✅
- `confirm: true` for destructive writes: Tasks 10, 12 (cancel, announcement) ✅
- Re-fetch after write returning canonical state: Tasks 5, 6, 9, 10 return API response fields; Tasks 7, 8, 11, 12 return echo of created resource (which TeamSnap returns in POST response — no additional fetch needed) ✅
- Idempotency cache for POST tools: Tasks 7, 8, 9, 11, 12 ✅
- Collection+JSON error detail surfacing: Task 1 ✅
- Write endpoint constants: Task 2 ✅
- Vitest unit tests for pure helpers: Task 3 ✅
- README update + re-auth documentation: Task 15 ✅
- AWS rebuild + deploy: Tasks 16, 17 ✅

**No placeholders** — every step has either a file location, exact code block, or exact shell command with expected output.

**Type consistency** — `ToolArgs`, `CallToolResult`, `ParsedItem`, `ENDPOINTS` names match Phase 1's code. `core.write(method, endpoint, fields)` signature is used consistently across every write handler. `requireConfirm(args)` returns `{ ok: boolean; reason?: string }` and is called the same way in Tasks 10 and 12.

**Scope check** — 17 tasks, all within one subsystem (write expansion). No decomposition needed.

---

## Execution note

Tasks 1–4 are infrastructure and must run in order (write method before any write handler).  
Tasks 5–12 are independent of each other but share the core.write + writeSafety infrastructure, so any can go next once Task 4 is done.  
Tasks 13–14 unblock running the tools via the router.  
Task 15 is documentation.  
Task 16 is a required build step.  
Task 17 is gated on explicit user confirmation because it's a deploy.
