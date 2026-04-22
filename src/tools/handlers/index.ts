import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { error, type ToolArgs } from "./common.js";
import { handleAuth, handleAuthStatus, handleLogout } from "./auth.js";

export async function handleToolCall(name: string, args: ToolArgs): Promise<CallToolResult> {
  try {
    switch (name) {
      case "teamsnap_auth":
        return handleAuth(args);
      case "teamsnap_auth_status":
        return handleAuthStatus();
      case "teamsnap_logout":
        return handleLogout();
      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
