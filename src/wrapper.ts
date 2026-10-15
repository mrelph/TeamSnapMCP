#!/usr/bin/env node

/**
 * Local MCP wrapper that forwards requests to the AWS-hosted TeamSnap MCP server.
 * This allows Claude Desktop to use the remote MCP via stdio transport.
 *
 * Includes retry logic and error handling to survive Lambda cold starts
 * and transient network failures without crashing.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { callRemoteMCP } from "./utils/remoteMcp.js";

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
  try {
    const result = await callRemoteMCP(AWS_MCP_ENDPOINT, "tools/list") as { tools: unknown[] };
    return result;
  } catch (error) {
    console.error("tools/list failed after retries:", error);
    // Return empty tools list so the server stays alive
    return { tools: [] };
  }
});

// Forward tools/call to remote
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await callRemoteMCP(AWS_MCP_ENDPOINT, "tools/call", { name, arguments: args });
    return result as { content: Array<{ type: string; text: string }> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Return the error as tool content instead of crashing
    return {
      content: [{ type: "text", text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
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
