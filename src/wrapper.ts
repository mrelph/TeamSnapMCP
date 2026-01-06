#!/usr/bin/env node

/**
 * Local MCP wrapper that forwards requests to the AWS-hosted TeamSnap MCP server.
 * This allows Claude Desktop to use the remote MCP via stdio transport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

interface MCPResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

async function callRemoteMCP(method: string, params?: unknown): Promise<unknown> {
  const response = await fetch(AWS_MCP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as MCPResponse;

  if (data.error) {
    throw new Error(data.error.message);
  }

  return data.result;
}

const server = new Server(
  {
    name: "teamsnap-mcp-wrapper",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Forward tools/list to remote
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await callRemoteMCP("tools/list") as { tools: unknown[] };
  return result;
});

// Forward tools/call to remote
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await callRemoteMCP("tools/call", { name, arguments: args });
  return result as { content: Array<{ type: string; text: string }> };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TeamSnap MCP wrapper connected to:", AWS_MCP_ENDPOINT);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
