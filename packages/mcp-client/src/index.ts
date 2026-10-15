#!/usr/bin/env node

/**
 * Local MCP stdio bridge for the AWS-hosted TeamSnap MCP server.
 * Allows Claude Desktop to use the remote MCP via: npx -y teamsnap-mcp
 *
 * Requires TEAMSNAP_MCP_ENDPOINT env var pointing to the API Gateway URL.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { callRemoteMCP } from "./remoteMcp.js";

function getEndpoint(): string {
  const endpoint = process.env.TEAMSNAP_MCP_ENDPOINT;
  if (!endpoint) {
    console.error("Error: TEAMSNAP_MCP_ENDPOINT environment variable is required");
    console.error("Set it to your AWS API Gateway endpoint, e.g.:");
    console.error("  https://your-api-id.execute-api.us-west-2.amazonaws.com/mcp");
    process.exit(1);
  }
  return endpoint;
}

const AWS_MCP_ENDPOINT = getEndpoint();

const server = new Server(
  {
    name: "teamsnap-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const result = await callRemoteMCP(AWS_MCP_ENDPOINT, "tools/list") as { tools: unknown[] };
    return result;
  } catch (error) {
    console.error("tools/list failed after retries:", error);
    return { tools: [] };
  }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await callRemoteMCP(AWS_MCP_ENDPOINT, "tools/call", { name, arguments: args });
    return result as { content: Array<{ type: string; text: string }> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TeamSnap MCP bridge connected to:", AWS_MCP_ENDPOINT);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
