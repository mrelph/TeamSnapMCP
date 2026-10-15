# TeamSnap MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude to your TeamSnap account. Read and manage teams, rosters, events, availability, volunteer sign-ups, and team communications directly from Claude Desktop or CLI.

## Features

- **21 read tools** — teams, rosters, events, availability, locations, contacts, announcements, assignments, opponents, standings, stats, forums, calendars, and custom fields
- **9 write tools** — set RSVPs, create/update/cancel/delete events, create and assign tracked items (snacks, volunteers, carpools), send team messages, and send broadcast email/push announcements
- **Safety rails on every write** — `preview: true` by default returns the payload without writing to TeamSnap; destructive writes additionally require `confirm: true`; POST tools support an optional `idempotency_key`. See [Write Tools & Safety](#write-tools--safety).
- **Localized event times** — events always returned in their own timezone; optional viewer-timezone field for travel
- **Secure** — OAuth 2.0 with AES-256-GCM encrypted local storage or DynamoDB
- **Flexible Deployment** — Run locally, via npx, or on AWS Lambda

## Prerequisites

- Node.js >= 18
- A [TeamSnap Developer](https://developer.teamsnap.com) OAuth application (Client ID + Secret)

## Quick Start

### 1. Get TeamSnap OAuth Credentials

1. Go to [TeamSnap Developer Portal](https://developer.teamsnap.com)
2. Create a new application
3. Set the redirect URI (see deployment options below)
4. Note your **Client ID** and **Client Secret**

### 2. Choose Your Deployment

#### Option A: Local MCP Server

Best for development. Requires a tunnel (e.g., Cloudflare) for the OAuth callback.

```bash
git clone https://github.com/mrelph/TeamSnapMCP.git
cd TeamSnapMCP
cp .env.example .env   # Add your credentials
npm install
npm run build
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "teamsnap": {
      "command": "node",
      "args": ["/path/to/TeamSnapMCP/dist/index.js"],
      "env": {
        "TEAMSNAP_CLIENT_ID": "your-client-id",
        "TEAMSNAP_CLIENT_SECRET": "your-client-secret",
        "TEAMSNAP_REDIRECT_URI": "https://your-tunnel-url/callback"
      }
    }
  }
}
```

> **Tip:** Use `cloudflared tunnel --url http://localhost:8374` to create an HTTPS callback URL.

#### Option B: npx (Connects to AWS Deployment)

Easiest option if the AWS backend is already deployed. No local clone needed.

```json
{
  "mcpServers": {
    "teamsnap": {
      "command": "npx",
      "args": ["-y", "teamsnap-mcp"],
      "env": {
        "TEAMSNAP_MCP_ENDPOINT": "https://your-api-id.execute-api.us-east-1.amazonaws.com/mcp"
      }
    }
  }
}
```

#### Option C: AWS Serverless

Deploy to AWS Lambda for a permanent HTTPS callback URL — no tunnels needed.

```bash
cd aws
npm install
```

Set environment variables:

```bash
export AWS_ACCESS_KEY_ID=your-aws-key
export AWS_SECRET_ACCESS_KEY=your-aws-secret
export AWS_REGION=us-east-1
export TEAMSNAP_CLIENT_ID=your-client-id
export TEAMSNAP_CLIENT_SECRET=your-client-secret
```

Deploy:

```bash
node scripts/deploy.cjs
```

This creates:
- **API Gateway** — Permanent HTTPS endpoint
- **Lambda** — MCP server (Node.js 20, 256MB, 30s timeout)
- **DynamoDB** — Token storage with TTL auto-cleanup

Then configure Claude Desktop to use the **wrapper**:

```json
{
  "mcpServers": {
    "teamsnap": {
      "command": "node",
      "args": ["/path/to/TeamSnapMCP/dist/wrapper.js"],
      "env": {
        "TEAMSNAP_MCP_ENDPOINT": "https://your-api-id.execute-api.us-east-1.amazonaws.com/mcp"
      }
    }
  }
}
```

### 3. Authenticate

Tell Claude: **"Connect to TeamSnap"**

A browser window will open for OAuth login. Once you authorize, you're connected.

## Available Tools

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
| `teamsnap_set_availability` | Set a member's RSVP for an event (preview by default) | `event_id`, `member_id`, `status` |
| `teamsnap_update_tracked_item_status` | Update a tracked-item status (preview by default) | `tracked_item_status_id`, `status` |
| `teamsnap_create_tracked_item` | Create a snack/volunteer/carpool tracked item (preview by default) | `team_id`, `name` |
| `teamsnap_assign_tracked_item` | Assign a tracked item to a member (preview by default) | `tracked_item_id`, `member_id` |
| `teamsnap_create_event` | Create game/event; optional native schedule notification (preview by default) | `team_id`, `name`, `start_date` |
| `teamsnap_update_event` | Update/cancel or change game/TBD flags; confirm required for cancel/notifications | `event_id`, `patch` |
| `teamsnap_delete_event` | Delete one exact event after checking expected team; never a whole series | `event_id`, `team_id` |
| `teamsnap_send_team_message` | Post an in-app team message (preview by default) | `team_id`, `body` |
| `teamsnap_send_announcement` | Send an email/alert broadcast; confirm required to send | `team_id`, `channel`, `subject`, `body` |

### Availability Status Codes

The `teamsnap_get_availability` tool groups members into four categories based on the TeamSnap `status_code` field returned by the API:

| Status | Numeric code | String code | Meaning |
|--------|-------------|-------------|---------|
| `yes` | `1` | `"yes"` | Member marked as available |
| `no` | `0` | `"no"` | Member declined (not attending) |
| `maybe` | `2` | `"maybe"` | Member is uncertain |
| `noResponse` | null/absent | — | Member has not responded |

> **Note:** The numeric code `0` for "declined" is a falsy value in JavaScript. The server uses nullish coalescing (`??`) rather than the logical OR (`||`) operator when reading `status_code` to ensure that a numeric `0` is correctly categorized as "no" rather than silently falling through to "no response".

## Write Tools & Safety

The server exposes 9 write tools that can modify TeamSnap data. They follow consistent safety rails:

- **`preview: true` by default.** Every write tool returns the payload it *would* send without writes or notifications (deletion previews read TeamSnap to verify the exact target), so you can inspect first. Pass `preview: false` to commit.
- **`confirm: true` for destructive actions.** `teamsnap_send_announcement` and `teamsnap_delete_event` always require it; `teamsnap_update_event` requires it for cancellation. Create/update/delete with `notify_team: true` also require it. These are tool safeguards, not a requirement to ask for human approval again when the exact action is already authorized.
- **`idempotency_key` for POST tools.** Optional 60-second in-memory dedup cache keyed on the value you supply. Best-effort on Lambda (short function lifetime).
- **Re-authentication.** If you authenticated before Phase 2, your existing token has `read` scope only. Your first write will return `reauthentication_required` — just run `teamsnap_auth` again to get a `read write` token. Reads continue to work throughout.

### Native schedule notifications and deletion

- `teamsnap_create_event` and `teamsnap_update_event` accept top-level `notify_team` (default **false**) and `notify_team_as_member_id`. The latter is the sending **team-member ID**, not the account/user ID, and is required when notifying. Do not place notification controls inside `patch`.
- Creation uses `is_game: true` for games; `is_tbd` is accepted on create and in update patches. These are independent flags: a TBD placeholder may already be a game.
- `notify_team: true` requests TeamSnap's **native schedule-change notification**, not a separate `teamsnap_send_announcement` broadcast. It requires `preview: false` and `confirm: true` to commit. Results distinguish `status: "preview"`, `"blocked"`, or `"committed"` and report notification request intent, **not verified recipient delivery**. Recipient settings and provider behavior still apply.
- `teamsnap_delete_event` requires exact numeric `event_id` and expected `team_id`. Preview reads the event and returns its localized target summary; commit re-reads and validates both IDs. It sends a Collection+JSON DELETE body with `repeating_include: "none"`, so only that occurrence is removed. Deletion is not cancellation; associated availability responses are lost, and replacements have new IDs/RSVPs. No automatic replacement, rollback, or series deletion is provided.
- Deletion also accepts the same native notification options. Cancellation remains `teamsnap_update_event` with `patch.is_canceled: true`; confirmation is still required whether or not notification is requested. An explicit `notify_team: false` records the request choice, not proof that TeamSnap suppresses every independent provider reminder or notification.
- Both remote bridges retry only known reads and previews. **Committed writes are attempted once** after ambiguous failures; notification-bearing PATCH calls are not safely replayable. An error after submission means the outcome may be unknown: inspect the current schedule before resubmitting. POST `idempotency_key` remains only a short-lived, process-local aid, not an exactly-once guarantee. Event-create keys are bound to team and payload; reusing a live key for changed event fields is rejected.

Examples (each defaults to preview; add `preview: false, confirm: true` only for an authorized commit):

```json
{"tool":"teamsnap_create_event","arguments":{"team_id":"456","name":"Away game","is_game":true,"is_tbd":false,"start_date":"2027-01-23T18:00:00Z","opponent_id":"321","location_id":"654","notify_team":true,"notify_team_as_member_id":"789"}}
{"tool":"teamsnap_update_event","arguments":{"event_id":"123","patch":{"is_tbd":false,"start_date":"2027-01-23T18:00:00Z"},"notify_team":true,"notify_team_as_member_id":"789"}}
{"tool":"teamsnap_delete_event","arguments":{"event_id":"123","team_id":"456","notify_team":false}}
{"tool":"teamsnap_update_event","arguments":{"event_id":"123","patch":{"is_canceled":true},"notify_team":false}}
```

The notification sender and DELETE-body contracts follow TeamSnap's official SDK: [events](https://github.com/teamsnap/teamsnap-javascript-sdk/blob/main/src/collections/events.coffee), [model](https://github.com/teamsnap/teamsnap-javascript-sdk/blob/main/src/model.coffee). Development qualification uses mocked writes; it does not establish live delivery.

### Example: preview → commit flow

```
You: "RSVP Mark as 'yes' for event 12345"
Claude (calls teamsnap_set_availability with defaults):
  { preview: true, would_patch: "availability 987", with: { status: "yes", status_code: 1, notes: null } }
You: "Looks right, do it"
Claude (calls teamsnap_set_availability with preview: false):
  { status: "yes", event_id: 12345, member_id: 67890, notes: null }
```

## Example Prompts

**Reading:**
- "What teams do I have in TeamSnap?"
- "Show me the roster for the Jr Kraken"
- "What games do we have scheduled this month?"
- "Who's available for Saturday's game?"
- "Who has declined Saturday's game?"

**Writing (preview first, commit second):**
- "Preview setting my RSVP to yes for Saturday's game" → inspect the payload → "Looks right, do it"
- "Create a snack sign-up called 'Post-game snacks' for next week's event"
- "Post a team message saying 'Uniforms this Saturday are white'"
- "Draft an announcement to the team about Sunday's rain-out — don't send it until I confirm"

## Architecture

```
Local Deployment:

  Claude Desktop <--stdio--> MCP Server (Node.js)
                                   |
                              TeamSnap API
                                   |
                         localhost:8374 (OAuth callback)


AWS Deployment:

  Claude Desktop <--stdio--> Wrapper --HTTPS--> API Gateway
                                                     |
                                                  Lambda
                                                  |     |
                                            DynamoDB   TeamSnap API
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TEAMSNAP_CLIENT_ID` | Yes (local) | — | OAuth Client ID |
| `TEAMSNAP_CLIENT_SECRET` | Yes (local) | — | OAuth Client Secret |
| `TEAMSNAP_CALLBACK_PORT` | No | `8374` | Local OAuth callback port |
| `TEAMSNAP_REDIRECT_URI` | No | — | Override redirect URI (for tunnels) |
| `TEAMSNAP_MCP_ENDPOINT` | AWS wrapper only | — | API Gateway endpoint URL |
| `TEAMSNAP_TIMEZONE` | No | — | Your personal ("viewer") timezone. Events are always localized to their own timezone first (from the API); if this variable is set to a different IANA zone, tools add a second `viewer` field so you can see both. Useful when traveling. |

## Security

- **Encryption** — Local tokens encrypted with AES-256-GCM (scrypt key derivation)
- **OAuth scope** — `read write` scope requested from TeamSnap; writes are gated behind `preview`/`confirm` (see [Write Tools & Safety](#write-tools--safety))
- **No hardcoded credentials** — All secrets loaded from environment variables
- **CSRF protection** — OAuth state parameter validation
- **Auto-cleanup** — DynamoDB TTL removes stale pending auth after 10 minutes
- **File permissions** — Local credentials saved with `0600` (owner-only)

## Development

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript
npm run dev       # Watch mode
node dist/index.js      # Run local server
node dist/wrapper.js    # Run AWS wrapper
```

### AWS deployment

```bash
cd aws
npm install
npm run build           # Bundle with esbuild
node scripts/deploy.cjs # Deploy to AWS
```

## License

MIT
