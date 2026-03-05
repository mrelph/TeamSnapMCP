# TeamSnap MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude to your TeamSnap account. Access your teams, rosters, events, and availability data directly from Claude Desktop or CLI.

## Features

- **Teams** — List and view all your TeamSnap teams
- **Rosters** — Get player and coach information
- **Events** — View games, practices, and other events with date filtering
- **Availability** — Check who's available for events, with correct handling of all RSVP states including numeric status codes
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

| Tool | Description | Parameters |
|------|-------------|------------|
| `teamsnap_auth` | Connect to TeamSnap via OAuth | `client_id?`, `client_secret?` |
| `teamsnap_auth_status` | Check connection status | — |
| `teamsnap_logout` | Disconnect and clear credentials | — |
| `teamsnap_list_teams` | List all your teams | — |
| `teamsnap_get_team` | Get team details | `team_id` |
| `teamsnap_get_roster` | Get players and coaches | `team_id` |
| `teamsnap_get_events` | Get team events | `team_id`, `start_date?`, `end_date?` |
| `teamsnap_get_event` | Get event details | `event_id` |
| `teamsnap_get_availability` | Get event RSVP status for all members | `event_id` |

### Availability Status Codes

The `teamsnap_get_availability` tool groups members into four categories based on the TeamSnap `status_code` field returned by the API:

| Status | Numeric code | String code | Meaning |
|--------|-------------|-------------|---------|
| `yes` | `1` | `"yes"` | Member marked as available |
| `no` | `0` | `"no"` | Member declined (not attending) |
| `maybe` | `2` | `"maybe"` | Member is uncertain |
| `noResponse` | null/absent | — | Member has not responded |

> **Note:** The numeric code `0` for "declined" is a falsy value in JavaScript. The server uses nullish coalescing (`??`) rather than the logical OR (`||`) operator when reading `status_code` to ensure that a numeric `0` is correctly categorized as "no" rather than silently falling through to "no response".

## Example Prompts

- "What teams do I have in TeamSnap?"
- "Show me the roster for the Jr Kraken"
- "What games do we have scheduled this month?"
- "Who's available for Saturday's game?"
- "Who has declined Saturday's game?"

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

## Security

- **Encryption** — Local tokens encrypted with AES-256-GCM (scrypt key derivation)
- **Read-only** — Only `read` scope requested from TeamSnap
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
