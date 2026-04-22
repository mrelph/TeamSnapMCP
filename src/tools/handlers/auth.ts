import open from "open";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { startOAuthFlow } from "../../auth/oauth.js";
import { clearCredentials, hasCredentials, loadCredentials } from "../../utils/storage.js";
import { success, error, type ToolArgs } from "./common.js";

export async function handleAuth(args: ToolArgs): Promise<CallToolResult> {
  const clientId = (args.client_id as string) || process.env.TEAMSNAP_CLIENT_ID;
  const clientSecret = (args.client_secret as string) || process.env.TEAMSNAP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return error(
      "Missing client_id or client_secret. Either pass them as arguments or set TEAMSNAP_CLIENT_ID and TEAMSNAP_CLIENT_SECRET."
    );
  }
  try {
    const { authUrl, waitForCallback } = await startOAuthFlow({ clientId, clientSecret });
    await open(authUrl);
    const credentials = await waitForCallback();
    return success({
      status: "authenticated",
      message: "Successfully connected to TeamSnap!",
      user: { id: credentials.teamsnapUserId, email: credentials.teamsnapEmail },
    });
  } catch (err) {
    return error(`Authentication failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleAuthStatus(): Promise<CallToolResult> {
  if (!hasCredentials()) {
    return success({ authenticated: false, message: "Not connected to TeamSnap. Use teamsnap_auth to connect." });
  }
  const credentials = loadCredentials();
  if (!credentials) {
    return success({ authenticated: false, message: "Not connected to TeamSnap. Use teamsnap_auth to connect." });
  }
  teamsnapClient.reloadCredentials();
  try {
    const user = await teamsnapClient.getMe();
    return success({
      authenticated: true,
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
    });
  } catch {
    return success({
      authenticated: true,
      user: { id: credentials.teamsnapUserId, email: credentials.teamsnapEmail },
      note: "Could not fetch fresh user info - token may need refresh",
    });
  }
}

export async function handleLogout(): Promise<CallToolResult> {
  clearCredentials();
  teamsnapClient.reloadCredentials();
  return success({ status: "logged_out", message: "Successfully disconnected from TeamSnap." });
}
