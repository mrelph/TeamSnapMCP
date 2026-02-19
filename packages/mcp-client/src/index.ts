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

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 30000;

interface MCPResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callRemoteMCP(method: string, params?: unknown): Promise<unknown> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(AWS_MCP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as MCPResponse;

      if (data.error) {
        throw new Error(data.error.message);
      }

      return data.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt + 1}/${MAX_RETRIES} failed for ${method}: ${lastError.message}`);

      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError;
}

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
    const result = await callRemoteMCP("tools/list") as { tools: unknown[] };
    return result;
  } catch (error) {
    console.error("tools/list failed after retries:", error);
    return { tools: [] };
  }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await callRemoteMCP("tools/call", { name, arguments: args });
    return result as { content: Array<{ type: string; text: string }> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error calling ${name}: ${message}. The remote server may be temporarily unavailable — please try again.` }],
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
