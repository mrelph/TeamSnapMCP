# TeamSnap MCP Server

A Model Context Protocol (MCP) server that connects Claude to your TeamSnap account. Access your teams, rosters, events, and availability data directly from Claude Desktop or CLI.

## Features

- **Teams**: List and view all your TeamSnap teams
- **Rosters**: Get player and coach information
- **Events**: View games, practices, and other events
- **Availability**: Check who's available for events
- **Secure**: OAuth 2.0 authentication with encrypted token storage
- **AWS Deployment**: Optional serverless deployment with permanent HTTPS callback URL

## Quick Start

### 1. Get TeamSnap OAuth Credentials

1. Go to [TeamSnap Developer Portal](https://developer.teamsnap.com)
2. Create a new application
3. Set the redirect URI (see options below)
4. Note your Client ID and Client Secret

### 2. Choose Your Deployment

#### Option A: Local MCP Server

For local development with a tunnel for OAuth callback.

```bash
git clone https://github.com/yourusername/TeamSnapMCP.git
cd TeamSnapMCP
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

**Redirect URI**: Use a tunnel like `cloudflared tunnel --url http://localhost:8374` for HTTPS callback.

#### Option B: AWS Serverless (Recommended)

Deploy to AWS Lambda for a permanent HTTPS callback URL with no tunnels needed.

```bash
cd aws
npm install
```

Set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your-aws-key
export AWS_SECRET_ACCESS_KEY=your-aws-secret
export AWS_REGION=us-west-2
export TEAMSNAP_CLIENT_ID=your-client-id
export TEAMSNAP_CLIENT_SECRET=your-client-secret
```

Deploy:
```bash
node scripts/deploy.cjs
```

This creates:
- API Gateway with permanent HTTPS URL
- Lambda function for MCP server
- DynamoDB table for token storage

Then use the **wrapper** for Claude Desktop:

```json
{
  "mcpServers": {
    "teamsnap": {
      "command": "node",
      "args": ["/path/to/TeamSnapMCP/dist/wrapper.js"],
      "env": {
        "TEAMSNAP_MCP_ENDPOINT": "https://your-api-id.execute-api.us-west-2.amazonaws.com/mcp"
      }
    }
  }
}
```

### 3. Authenticate

Tell Claude: **"Connect to TeamSnap"**

A browser will open for OAuth login. Once complete, you're connected!

## Available Tools

| Tool | Description |
|------|-------------|
| `teamsnap_auth` | Connect to TeamSnap |
| `teamsnap_auth_status` | Check connection status |
| `teamsnap_logout` | Disconnect from TeamSnap |
| `teamsnap_list_teams` | List all your teams |
| `teamsnap_get_team` | Get team details |
| `teamsnap_get_roster` | Get players and coaches |
| `teamsnap_get_events` | Get team events |
| `teamsnap_get_event` | Get event details |
| `teamsnap_get_availability` | Get event availability |

## Example Prompts

- "What teams do I have in TeamSnap?"
- "Show me the roster for the Jr Kraken"
- "What games do we have scheduled this month?"
- "Who's available for Saturday's game?"

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS (Optional)                           │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐ │
│  │ API Gateway  │───▶│   Lambda     │───▶│   DynamoDB    │ │
│  │   (HTTPS)    │    │ (MCP Server) │    │   (Tokens)    │ │
│  └──────────────┘    └──────────────┘    └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ HTTP/SSE
         ▼
   ┌───────────┐         ┌───────────────┐
   │  Wrapper  │◀───────▶│ Claude Desktop│
   │  (stdio)  │         │               │
   └───────────┘         └───────────────┘
```

## Security

- OAuth tokens encrypted with AES-256-GCM (local) or stored in DynamoDB (AWS)
- Only read access requested from TeamSnap
- No credentials stored in code

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js

# Run wrapper (connects to AWS)
node dist/wrapper.js
```

## License

MIT
