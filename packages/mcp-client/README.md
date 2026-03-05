# teamsnap-mcp

Local stdio bridge for the [TeamSnap MCP Server](https://github.com/mrelph/TeamSnapMCP) running on AWS Lambda. Lets Claude Desktop (or any MCP-compatible client) talk to the remote server with zero local setup beyond Node.js.

## Quick Start

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

Restart Claude Desktop. The bridge connects automatically.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TEAMSNAP_MCP_ENDPOINT` | Yes | Full URL of the AWS API Gateway MCP endpoint |

## How It Works

`teamsnap-mcp` runs as a local stdio MCP server. It receives JSON-RPC requests from Claude Desktop over stdin, forwards them to your AWS Lambda endpoint via HTTPS, and pipes responses back over stdout. Includes automatic retry logic (3 attempts with exponential backoff) to handle Lambda cold starts and transient failures.

### Authentication in AWS Mode

Because there is no local process to open a browser window, the `teamsnap_auth` tool in AWS mode returns a URL for you to open manually. After visiting the URL and completing the OAuth flow, use `teamsnap_auth_status` to confirm the connection.

### Availability / RSVP Data

The `teamsnap_get_availability` tool returns member RSVP status grouped into four buckets: `yes`, `no`, `maybe`, and `noResponse`. TeamSnap represents a declined response with the numeric status code `0`. The server correctly handles this using nullish coalescing so that a numeric `0` is categorized as "no" rather than "no response".

## Related

- [TeamSnap MCP Server](https://github.com/mrelph/TeamSnapMCP) — Full project with local and AWS deployment options
