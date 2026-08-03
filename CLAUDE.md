# TeamSnap MCP Server

Model Context Protocol server exposing TeamSnap (teams, rosters, events, RSVPs, tracked items, announcements) as tools for Claude. TypeScript, ESM, Node >= 18. 22 read tools + 9 write tools.

## Commands

Root package (`@teamsnap/mcp-server`):
- `npm install`
- `npm run build` — `tsc`, emits to `dist/`
- `npm run dev` — `tsc --watch`
- `npm test` — `vitest run` (tests in `tests/**/*.test.ts`)
- `npm run test:watch` — `vitest`
- `npm start` — `node dist/index.js` (runs the stdio server)
- Run local server: `node dist/index.js`; AWS wrapper: `node dist/wrapper.js`

AWS package (separate, in `aws/`, run `npm install` there first):
- `npm run build` — esbuild bundles `src/lambda.ts` → `dist/lambda.js` (CJS, node20)
- Deploy: `node scripts/deploy.cjs` (README) — provisions DynamoDB + IAM + Lambda + API Gateway. Note: `aws/package.json`'s `deploy` script points at `scripts/deploy.js`; both files exist.

## Architecture

- `src/index.ts` — entry point. Creates MCP `Server`, connects `StdioServerTransport`. Registers `ListToolsRequestSchema` (returns `tools`) and `CallToolRequestSchema` (dispatches via `handleToolCall`). Logs to stderr only (stdout is the MCP channel).
- `src/tools/index.ts` — the `tools` array: every tool's name, description, and JSON input schema. Adding a tool means editing this array AND the dispatch switch.
- `src/tools/handlers/index.ts` — `handleToolCall(name, args)` is one big `switch` mapping tool name → handler. Handlers live in `src/tools/handlers/*.ts` grouped by domain (auth, teams, roster, events, availability, assignments, announcements, opponents, stats, forum, meta).
- `src/api/` — `core.ts` (`TeamSnapCore.request`, Collection+JSON parsing, token refresh), `client.ts`, `endpoints.ts` (`API_BASE=https://api.teamsnap.com/v3`, `TOKEN_URL=https://auth.teamsnap.com/oauth/token`), `types.ts`.
- `src/auth/oauth.ts` — OAuth 2.0 flow. `src/utils/storage.ts` — AES-256-GCM encrypted local token store (scrypt key from machine/USER + salt, files written `0600`).
- `src/wrapper.ts` — thin stdio client that forwards to the AWS-hosted server via `TEAMSNAP_MCP_ENDPOINT`; has cold-start retry logic.
- `aws/src/lambda.ts` — Lambda handler (HTTP/JSON-RPC over API Gateway), `dynamodb.ts` for token storage.

## Conventions

- ESM throughout (`"type": "module"`); relative imports use `.js` extensions even in `.ts` source (NodeNext resolution).
- `tsc` is strict. Keep tool schema in `tools/index.ts` and the handler switch in sync.
- Tests: Vitest, `pool: "forks"`, `globals: false` (import from `vitest`). `toolWiring.test.ts` guards tool-list/dispatch-switch parity and write-tool safety rails. `parity.test.ts` is SKIPPED — it imports `aws/src/client.ts`, whose `@aws-sdk` deps live in `aws/package.json` and are never installed at the root; pre-existing failure on main.
- Tests must never silently pass when unauthenticated. `if (result.isError) return` makes a test vacuous in exactly the condition CI runs in. Assert the specific outcome instead.

## Gotchas

- **Two transports for the same tools:** local = stdio server (`index.ts`); AWS = stdio `wrapper.ts` → API Gateway → Lambda (JSON-RPC). Keep both in mind when changing tool behavior.
- **Write-tool safety rails:** every write tool is `preview: true` by default (returns payload, no API call). `teamsnap_send_announcement` and `teamsnap_delete_event` always need `confirm: true`; `teamsnap_update_event` needs `confirm: true` only when `patch.is_canceled` is true. See `src/utils/writeSafety.ts`.
- **Member permissions are READ-ONLY here.** `teamsnap_whoami_members` reports is_manager/is_owner/is_commissioner for the authenticated user across their teams. There is deliberately NO write path against `/members` — do not add promote/demote tools without an explicit decision.
- **Arrival time is a native field, never arithmetic.** `arrival_minutes_early` maps to the event's `minutes_to_arrive_early`. `start_date` is the real start time and must go out verbatim — never subtract the arrival offset from it.
- **`idempotency_key` is scoped, not global.** `idempotencyScope(tool, target, payload)` namespaces the caller-supplied key. Keys are model-generated and collide (`"1"`, `"retry"`); an unscoped cache replayed an unrelated result and reported success for a write that never ran. Pass a scope at every `checkIdempotency`/`storeIdempotency` call site.
- **Interpolated ids need validating.** `ENDPOINTS.*ById(id)` goes straight into the URL and `..` segments normalize away, so an unvalidated id can retarget another endpoint. `teamsnap_delete_event` enforces `/^\d+$/`; the other `*ById` call sites do not yet.
- **`confirm` authorizes, `preview: false` executes.** They are independent: passing `confirm: true` alone still only previews. A write happens only when `preview: false` is passed, and — for a destructive change — `confirm: true` as well.
- **OAuth scope:** `read write` requested. Tokens issued before write support have `read` only → first write returns `reauthentication_required`; re-run `teamsnap_auth`.
- **Availability status codes:** TeamSnap `status_code` uses numeric `0` for "no" (falsy). Use `??`, never `||`, when reading it.
- **Local OAuth callback** needs an HTTPS redirect (tunnel, e.g. cloudflared) on port `8374` (`TEAMSNAP_CALLBACK_PORT`); AWS deploy gives a permanent API Gateway callback instead.
- **AWS region:** `deploy.cjs` defaults to `us-west-2` (`AWS_REGION` overrides); README examples show `us-east-1`. Confirm the region before deploying.
- **Secrets** come only from env (`TEAMSNAP_CLIENT_ID`, `TEAMSNAP_CLIENT_SECRET`, etc.). `.env` and `aws/.env` are gitignored; never commit them.

## Env vars

`TEAMSNAP_CLIENT_ID`, `TEAMSNAP_CLIENT_SECRET` (required local), `TEAMSNAP_CALLBACK_PORT` (default 8374), `TEAMSNAP_REDIRECT_URI` (tunnel override), `TEAMSNAP_MCP_ENDPOINT` (wrapper→AWS), `TEAMSNAP_TIMEZONE` (viewer tz). See `.env.example`.
