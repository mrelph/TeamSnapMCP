# teamsnap-mcp

Local stdio bridge for the [TeamSnap MCP server](https://github.com/your-org/teamsnap-mcp) running on AWS Lambda. Lets Claude Desktop (or any MCP-compatible client) talk to the remote server with zero local setup beyond Node.js.

## Quick start

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

Restart Claude Desktop. The bridge will connect automatically.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TEAMSNAP_MCP_ENDPOINT` | Yes | Full URL of the AWS API Gateway MCP endpoint |

## How it works

`teamsnap-mcp` runs as a local stdio MCP server. It receives JSON-RPC requests from Claude Desktop over stdin, forwards them to your AWS Lambda endpoint via HTTPS, and pipes responses back over stdout. Includes automatic retry logic (3 attempts with backoff) to handle Lambda cold starts and transient failures.
