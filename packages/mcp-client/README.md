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

## Related

- [TeamSnap MCP Server](https://github.com/mrelph/TeamSnapMCP) — Full project with local and AWS deployment options
