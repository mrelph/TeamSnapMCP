# TeamSnap MCP — API Coverage Expansion

**Date:** 2026-04-21
**Status:** Design approved; ready for implementation planning
**User role driving design:** Head coach

## Context

The TeamSnap MCP server exposes 9 tools that consume 5 API endpoints (`/me`, `/teams/search`, `/members/search`, `/events/search`, `/availabilities/search`). Live discovery against the author's real account surfaces **91 rels on a single team record** and **13 rels on a single event record** — the vast majority of TeamSnap's surface is untapped. Existing responses also aggressively over-filter: `get_event` returns 10 of 51 available fields; `get_roster` drops contact info entirely.

A separate standing bug around event time display (patched in commit `bd48730` with a `TEAMSNAP_TIMEZONE` env var) is a symptom of ignoring the per-event IANA timezone data the API already returns.

## Goals

1. Broaden MCP coverage to match a head coach's real workflow: announcements, snack/volunteer assignments, field locations, parent contacts, opponent history, standings, stats.
2. Add **write** capabilities for the coach-facing actions: send announcements, create/update/cancel events, set availability, create and assign tracked items.
3. Fix the timezone display bug at the root cause by using per-event IANA data.
4. Consolidate the two drifting `TeamSnapClient` implementations (`src/api/client.ts` and `aws/src/teamsnap.ts`) into a shared core so new capabilities land once.

## Non-goals (this iteration)

- Tier 3 / admin-financial: `team_fees`, `batch_invoices`, `member_balances`, Stripe/WePay/PayPal integrations, sponsors, advertisements.
- Roster membership changes (add/remove players via MCP); TeamSnap's invite flow is better-suited.
- Custom-field *definition* edits (we expose custom field values read-only).
- Event deletion (superseded by "cancel" semantics via `update_event` with `is_canceled`).
- Forum *posting*; read-only for now.

## Approach

**Domain-grouped tools + enrichment of existing tools.** Tool names correspond to questions a coach asks ("who's bringing snacks Saturday?") rather than mirroring API resources ("get tracked_items, get tracked_item_statuses, get assignments, join client-side"). Aggregation happens server-side where it's cheap.

Alternatives considered and rejected:
- **"Briefing" composite tools** (`event_briefing`, `team_briefing`): big responses blow MCP context budget; harder to compose; premature abstraction.
- **Structural 1:1 mirror** (one tool per API resource, 15+ new tools): forces Claude to orchestrate 3–4 calls per natural question; tool list becomes unwieldy.

## Scope

**In scope — 19 new tools (11 reads, 8 writes), plus enrichment of 4 existing tools.**

Read-only: still the default for unauthenticated users and read-scope tokens. Write scope expands OAuth request from `read` to `read write`.

### Authorization

OAuth scope changes from `read` to `read write`. Existing tokens continue working for reads; first write attempt with an old token returns a clear `reauthentication_required` error with instructions to re-run `teamsnap_auth`.

### Write-safety rails

- Every write tool accepts `preview: boolean` (default `true`). Preview returns the payload that would be POSTed/PATCHed without calling TeamSnap.
- Destructive writes (`send_announcement`, `update_event` with `is_canceled: true`) require explicit `confirm: true`. Without it, the tool returns preview and stops.
- Every successful write returns the updated object (re-fetched from TeamSnap) so Claude can confirm the actual post-state.
- POST writes accept an optional `idempotency_key` that the handler uses for a best-effort 60-second in-memory dedup cache.

## Architecture

### Current layout (problematic)

```
src/
  api/client.ts           - local TeamSnapClient, has getMemberAvailabilities
  tools/
    index.ts              - 9 tool definitions
    handlers.ts           - 373 lines, all handlers
  utils/storage.ts, config.ts
  index.ts (stdio), wrapper.ts (stdio -> HTTPS)
aws/src/
  teamsnap.ts             - AWS TeamSnapClient, missing getMemberAvailabilities
  lambda.ts, dynamodb.ts
```

`src/api/client.ts` and `aws/src/teamsnap.ts` are ~95% identical and have already drifted.

### Target layout

```
src/
  api/
    client.ts             - facade; wraps shared core with local credential store
    core.ts               - NEW: shared API core (HTTP, Collection+JSON parser,
                            resource methods). Single source of truth.
    endpoints.ts          - NEW: endpoint strings and rel constants
  auth/
    oauth.ts              - scope "read write"; migration logic
  tools/
    index.ts              - 28 tool definitions
    handlers/
      index.ts            - router (switch name -> handler)
      auth.ts             - auth, auth_status, logout
      teams.ts            - list_teams, get_team
      roster.ts           - get_roster, get_contacts, get_member_availability
      events.ts           - get_events, get_event, get_location,
                            create_event, update_event
      availability.ts     - get_availability, set_availability
      announcements.ts    - get_announcements, send_announcement,
                            send_team_message
      assignments.ts      - get_assignments, create_tracked_item,
                            assign_tracked_item, update_tracked_item_status
      opponents.ts        - get_opponents, get_results_and_standings
      stats.ts            - get_stats
      forum.ts            - get_forum_topics, get_forum_posts
      meta.ts             - get_calendar_urls, get_custom_data
  utils/
    time.ts               - NEW: localizeTime, localizeEventTimes
    storage.ts            - unchanged
    config.ts             - unchanged
  index.ts, wrapper.ts    - unchanged
aws/src/
  client.ts               - NEW: facade wrapping shared core with DynamoDB store
  lambda.ts               - imports handlers/ router directly (no reimplementation)
  dynamodb.ts             - unchanged
  teamsnap.ts             - DELETED
```

### Key architectural moves

1. **One API core, two credential facades.** `src/api/core.ts` owns HTTP + parsing + resource methods. The `client.ts` facades supply credential-loading from their respective backends (encrypted file vs DynamoDB). New methods land once.
2. **Handler directory by domain.** Splitting ~700 projected lines mirrors tool-naming taxonomy and makes review tractable.
3. **Handler router stays a simple switch.** No registry cleverness.
4. **Shared `utils/time.ts`** centralizes per-event TZ logic — no duplication, no way to forget the fallback chain.
5. **Lambda imports handlers directly.** Single dispatch code path for both deployments. Eliminates `aws/src/lambda.ts` reimplementation drift.

### What does not change

MCP protocol handling (SDK-provided), stdio wrapper logic, OAuth callback server on port 8374, DynamoDB schema, AES-256-GCM credential encryption, public tool naming convention (`teamsnap_*`), deployment pipeline.

## Tool surface

### Existing tools (9) — kept, most enriched

| Tool | Change |
|---|---|
| `teamsnap_auth` | Request `scope=read write` |
| `teamsnap_auth_status` | unchanged |
| `teamsnap_logout` | unchanged |
| `teamsnap_list_teams` | unchanged |
| `teamsnap_get_team` | **Enriched:** add `team_public_site_url`, `time_zone_iana_name`, `sport_name` |
| `teamsnap_get_roster` | **Enriched:** add `birthday`, `gender`, `photo_url`, `primary_email`, `primary_phone` per player |
| `teamsnap_get_events` | **Enriched:** add `arrival`, `duration_in_minutes`, `minutes_to_arrive_early`, `notes`, `uniform`, `additional_location_details`, `location_id`, `tracks_availability`, `game_type`, `is_tbd`, `points_for_team`, `points_for_opponent`, `formatted_results`; timezone redesign (see §Response shape) |
| `teamsnap_get_event` | **Enriched:** timezone redesign; inline full `location` object if `location_id` present |
| `teamsnap_get_availability` | unchanged |

### New read tools (11)

| Tool | Inputs | Output shape (summary) |
|---|---|---|
| `teamsnap_get_announcements` | `team_id`, `since?`, `limit?`=20 | Unions `broadcast_emails` + `broadcast_alerts` + `messages`, sorted by sent_at desc. Each item: `{id, type: "email"|"alert"|"message", subject, body_preview, sender, sent_at (localized), recipient_count?}` |
| `teamsnap_get_assignments` | exactly one of `team_id` or `event_id` | Joined `tracked_items` + `tracked_item_statuses` + `assignments`. Each item: `{assignment_id, tracked_item_name, member_id, member_name, due_date (localized), status: "pending"|"claimed"|"complete", notes}` |
| `teamsnap_get_location` | exactly one of `location_id` or `event_id` | `{id, name, address, lat, lng, url (google maps link), additional_details, phone}` |
| `teamsnap_get_contacts` | exactly one of `member_id` or `team_id` | `{count, contacts: [{member_id, first_name, last_name, label ("Parent"), emails, phones, is_emergency}]}` |
| `teamsnap_get_opponents` | `team_id` | Joined with `opponents_results`. Each: `{id, name, is_current_opponent, head_to_head: {wins, losses, ties, last_result}}` |
| `teamsnap_get_results_and_standings` | `team_id` | `{record: {wins, losses, ties, points_for, points_against}, standings: [...]}`. Joins `team_results` and `division_team_standings`. |
| `teamsnap_get_member_availability` | `member_id`, `start_date?`, `end_date?` | Wires the existing-but-orphaned `getMemberAvailabilities`. Each: `{event_id, event_name, event_start (localized), status, notes}` |
| `teamsnap_get_stats` | `team_id`, `scope: "team"|"member"|"event"`, `member_id?`, `event_id?` | `{scope, items: [{statistic_name, value, unit?, member_id?, event_id?}]}` |
| `teamsnap_get_forum_topics` | `team_id`, `limit?`=20 | `{count, topics: [{id, title, author, last_post_at (localized), post_count}]}` |
| `teamsnap_get_forum_posts` | `topic_id`, `limit?`=50 | `{topic_id, count, posts: [{id, author, created_at (localized), body}]}` |
| `teamsnap_get_calendar_urls` | `team_id` | `{ical_all, webcal_all, ical_games_only, webcal_games_only}` |
| `teamsnap_get_custom_data` | exactly one of `team_id` or `member_id` | `{scope, fields: [{name, value, type}]}` |

### New write tools (8)

| Tool | Inputs | Semantics |
|---|---|---|
| `teamsnap_send_announcement` | `team_id, channel: "email"|"alert", subject, body, recipient_member_ids?, preview?=true, confirm` | POSTs `broadcast_emails` or `broadcast_alerts`. **Requires `confirm: true` to send.** Preview shows the payload without sending. |
| `teamsnap_send_team_message` | `team_id, body, preview?=true` | POSTs `messages`. In-app only; no explicit confirm required. |
| `teamsnap_create_event` | `team_id, name, is_game, start_date, duration_in_minutes?, location_id?, opponent_id?, notes?, uniform?, arrival_minutes_early?, preview?=true` | POSTs `events`. Returns event with `start_date_local`. |
| `teamsnap_update_event` | `event_id, patch: {name?, start_date?, location_id?, duration_in_minutes?, notes?, uniform?, is_canceled?}, preview?=true, confirm` | PATCHes `events/:id`. **Requires `confirm: true` if `is_canceled` in patch.** |
| `teamsnap_set_availability` | `event_id, member_id, status: "yes"|"no"|"maybe", notes?` | PATCHes the matching `availabilities/:id` record. |
| `teamsnap_create_tracked_item` | `team_id, name, event_id?, due_date?, description?, preview?=true` | POSTs `tracked_items`. |
| `teamsnap_assign_tracked_item` | `tracked_item_id, member_id, preview?=true` | POSTs `assignments`. |
| `teamsnap_update_tracked_item_status` | `tracked_item_status_id, status: "pending"|"claimed"|"complete", notes?` | PATCHes `tracked_item_statuses/:id`. |

### Input validation

"Exactly one of" constraints (e.g. `{team_id?, event_id?}` where exactly one is required) are expressed in the JSON Schema's `oneOf` keyword for compatibility, but enforced at runtime with a clear error message since MCP hosts may ignore `oneOf`.

## Data flow

### Pattern 1: Compound read with parallel fetches

`get_announcements`:
1. Parallel: `broadcast_emails/search?team_id=X`, `broadcast_alerts/search?team_id=X`, `messages/search?team_id=X`.
2. Normalize to `{id, type, subject, body, sender_id, sent_at}`.
3. Sort by `sent_at` desc; slice to `limit`.
4. One extra `members/search?team_id=X` to resolve sender_id → name.
5. Localize timestamps via `utils/time.ts`.

Same pattern for `get_assignments`: parallel fetch of `tracked_items`, `assignments`, `tracked_item_statuses`; build lookup maps; join; resolve member names.

### Pattern 2: Inline-related read

`get_event` (enriched): fetch event; if `location_id` present, parallel-fetch the location and inline it under `location`. Same approach for `get_roster` with `member_email_addresses`/`member_phone_numbers`/`member_photos`, joined by `member_id`.

### Pattern 3: Hypermedia vs string endpoints

- **Hypermedia hrefs** (from `resource._links`) used for team-scoped aggregations where we already have the parent object. Authoritative, drift-proof, includes signed params (e.g. CSV export hashes).
- **String endpoints** used for direct ID lookups (`get_location(id)`).

`core.ts` exposes two low-level methods:

```ts
request<T>(endpoint: string, options?): Promise<T>      // existing
followLink<T>(resource, rel: string): Promise<T>        // new, hypermedia
```

### Pattern 4: Write flow

1. Validate args; missing `confirm` on destructive → return preview only.
2. If `preview: true` → build the Collection+JSON payload and return it without POST/PATCH.
3. Otherwise: POST or PATCH to the appropriate endpoint.
4. Non-2xx → surface the TeamSnap error detail (title + message).
5. Re-fetch the affected resource and return the canonical updated state with timestamps localized.

### Pattern 5: Idempotency

- PATCH writes are naturally idempotent.
- POST writes (`send_announcement`, `create_event`, `create_tracked_item`, `send_team_message`, `assign_tracked_item`) accept an optional `idempotency_key`. Handler keeps a 60-second in-memory dedup cache keyed on it. Lambda's short lifetime makes this best-effort — documented as such.

### Request budget per tool call

| Tool | API calls | Parallel? |
|---|---|---|
| `get_announcements` | 4 | yes |
| `get_assignments` | 4 | yes |
| `get_event` (enriched) | 2 | yes |
| `get_roster` (enriched) | 4 | yes |
| All write tools | 1–2 (+ optional re-fetch) | serial |

Worst case ~4 parallel calls per tool. Well under API Gateway's 30s timeout.

## Response shape & timezone

### Response shape policy

**Allowlist, not blocklist.** Each handler explicitly enumerates the fields it returns. Internal fields (`_href`, `_links`, `created_at`, `updated_at`, ad/billing IDs, template IDs) always stripped. Two exceptions pass through everywhere: `id` (Claude needs to chain calls) and raw UTC timestamps paired with localized versions.

**Size budgets (soft):**
- Per-item: target < 500 tokens.
- Per-response: target < 10K tokens. `get_events` on long-running teams clips to 50 items with `truncated: true` flag and steers users to `start_date`/`end_date` filters.

### Timezone — the fix

**Root cause of current bug:** `src/tools/handlers.ts:20` hardcodes one timezone via env var. Applied to every event regardless of where the event occurs. Cannot handle tournaments in other zones.

**Data TeamSnap returns per event (verified via live discovery):**

- `start_date` / `end_date` / `arrival_date` — authoritative UTC
- `time_zone_iana_name` — event's own IANA (`America/Los_Angeles`, `America/Phoenix`, etc.)
- `source_time_zone_iana_name` — zone event was authored in
- `time_zone` — human label ("Pacific Time (US & Canada)")
- `time_zone_offset` — resolved offset at that moment

**New `src/utils/time.ts`:**

```ts
export interface LocalizeOptions {
  viewerTZ?: string;  // from env TEAMSNAP_TIMEZONE, optional
}

export interface LocalizedTime {
  utc: string;              // authoritative UTC
  local: string;            // formatted in event's own TZ
  viewer?: string;          // formatted in viewer TZ, only if set AND differs from event TZ
  time_zone_iana: string;
  time_zone: string;        // human label
}

export function localizeTime(
  utcISO: string | null,
  eventTZ: string | null,
  eventTZLabel: string | null,
  options?: LocalizeOptions
): LocalizedTime | null;

export function localizeEventTimes<T>(
  event: T,
  options?: LocalizeOptions
): T & { start: LocalizedTime | null; end: LocalizedTime | null; arrival: LocalizedTime | null };
```

**Handler usage:**

```ts
const viewerTZ = process.env.TEAMSNAP_TIMEZONE;
const enriched = localizeEventTimes(rawEvent, { viewerTZ });
```

**Output shape — enriched `get_event` (home game, viewer in same zone):**

```json
{
  "start": {
    "utc": "2026-02-14T03:00:00Z",
    "local": "Fri, Feb 13, 7:00 PM PST",
    "time_zone_iana": "America/Los_Angeles",
    "time_zone": "Pacific Time (US & Canada)"
  },
  "end": { "...same shape..." },
  "arrival": { "...same shape..." }
}
```

**Output shape — tournament in Arizona, coach in Seattle, `TEAMSNAP_TIMEZONE=America/Los_Angeles`:**

```json
{
  "start": {
    "utc": "2026-06-14T19:00:00Z",
    "local": "Sat, Jun 14, 12:00 PM MST",
    "viewer": "Sat, Jun 14, 12:00 PM PDT",
    "time_zone_iana": "America/Phoenix",
    "time_zone": "Arizona (Mountain Standard Time)"
  }
}
```

**Properties:**
- Node 18+ Intl (already used) handles IANA zones natively; no new dependency.
- DST handled automatically (Node resolves offset per moment).
- Arizona's no-DST edge case handled (Phoenix is its own zone).
- No config required for the common case.
- `TEAMSNAP_TIMEZONE` becomes "where *I* am" — surfaces second formatted time only when event's zone differs. Removes the single-zone assumption.

### Backwards compatibility

Additive field changes to existing tool outputs are safe — unknown fields are informational to Claude.

**Breaking:** the existing `startDate`, `startDateUTC`, `endDate`, `timezone` keys on `get_events` and `startDateLocal`, `endDateLocal`, `timezone` on `get_event` are replaced by the new `start`/`end`/`arrival` object shape. Given the bug severity and that these outputs are consumed by Claude (not external scripts), we accept the break. The replacement is more correct in every case.

## Error handling

Read tools return structured results, not exceptions, for the predictable no-data cases:

```
{ empty: true, reason: "not_authorized" | "not_found" | "no_data" }
```

- `not_authorized` (403) — user lacks the role to read this rel (e.g. non-admin reading broadcast emails in some configs). Parents see this for some admin rels; head coaches see full data. Same tool, role-safe.
- `not_found` (404) — ID doesn't exist.
- `no_data` (200 with empty collection) — resource exists but is empty (e.g. no announcements yet).

Write tools return exceptions for TeamSnap API errors, surfacing the response body's `title`/`message` fields verbatim. Network errors get a generic `"network_error"` with the underlying message.

Token-expiry/401 flow: existing retry-once-with-refresh preserved in `core.ts`. If refresh fails, return a clear `"reauthentication_required"` error naming `teamsnap_auth` as the remedy.

## Testing

### Unit tests (new)

- `utils/time.ts`: boundary cases — DST transitions, Arizona no-DST, viewer == event TZ (should omit `viewer`), missing event TZ (falls back through chain).
- Response allowlist helpers per resource type.
- Collection+JSON parser (preserved from existing code).

### Integration tests (new, recorded)

- One test per new tool hitting the real API with a recorded fixture team. Use `msw` or nock to record/replay.
- Fixtures committed to `tests/fixtures/` so tests are deterministic and PR-reviewable.

### Contract tests

- Parity check: every method in `core.ts` has a handler using it; every handler's tool is registered in `tools/index.ts`; every AWS route is in the handler router. Runs as a build-time script.

### Manual smoke tests (pre-release)

Documented checklist — run against deployed Lambda + own teams:
- Auth flow with new `read write` scope.
- Each new read tool against at least one real team.
- Each write tool with `preview: true`, then a single real write in a throwaway event.
- Timezone correctness: home event (PST), tournament in Arizona (MST), ensure outputs match.

## Rollout / migration

1. **Phase 1 — read expansion + arch refactor + TZ fix.** No OAuth change; `scope` stays `read`. Ship the new read tools, handler directory split, shared core, `utils/time.ts`. Breaking change on event time output is in this phase.
2. **Phase 2 — write expansion.** OAuth scope becomes `read write`. Existing tokens keep working for reads. First write attempt with old token returns `reauthentication_required`. Document the re-auth step in README.
3. **README updates.** Updated tool table, new env-var behavior for `TEAMSNAP_TIMEZONE`, note on write scope and re-auth.

Ship phases as independent commits/PRs so if Phase 2 hits a snag we keep the Phase 1 improvements live.

## Open questions (resolved during brainstorming)

- **Q: Write in scope this iteration?** A: Yes. (User confirmed.)
- **Q: Preview default on write tools?** A: `preview: true` by default; explicit `confirm: true` required for destructive.
- **Q: Break vs keep old event time keys?** A: Break. New shape is strictly better; outputs are Claude-facing, not external-script-facing.
- **Q: TEAMSNAP_TIMEZONE — keep or remove?** A: Keep as "viewer" override. Surfaces a second formatted time only when event's zone differs from viewer's zone.
- **Q: Head coach-specific features?** A: `send_announcement`, `assign_tracked_item`, `create_tracked_item`, `update_event` (reschedule/cancel) — all included.
