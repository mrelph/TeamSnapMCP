import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".teamsnap-mcp");
export const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

export const TEAMSNAP_API_BASE = "https://api.teamsnap.com/v3";
export const TEAMSNAP_AUTH_URL = "https://auth.teamsnap.com/oauth/authorize";
export const TEAMSNAP_TOKEN_URL = "https://auth.teamsnap.com/oauth/token";

// OAuth callback server runs on this port
export const OAUTH_CALLBACK_PORT = parseInt(process.env.TEAMSNAP_CALLBACK_PORT || "8374", 10);

// Allow custom redirect URI for HTTPS tunnels (ngrok, cloudflare, etc.)
// If not set, falls back to localhost
export const OAUTH_REDIRECT_URI = process.env.TEAMSNAP_REDIRECT_URI || `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;

// Read-only mode is opt-in; preserve existing write-capable installations.
const readOnlySetting = process.env.TEAMSNAP_READ_ONLY;
if (readOnlySetting !== undefined && readOnlySetting !== "true" && readOnlySetting !== "false") {
  throw new Error("TEAMSNAP_READ_ONLY must be true or false");
}
export const TEAMSNAP_READ_ONLY = readOnlySetting === "true";
export const TEAMSNAP_SCOPES = TEAMSNAP_READ_ONLY ? "read" : "read write";
