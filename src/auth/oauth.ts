import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { TEAMSNAP_AUTH_URL, TEAMSNAP_TOKEN_URL, TEAMSNAP_SCOPES, OAUTH_CALLBACK_PORT, OAUTH_REDIRECT_URI } from "../utils/config.js";
import { saveCredentials, type StoredCredentials } from "../utils/storage.js";
import { teamsnapClient } from "../api/client.js";

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

export function generateAuthUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: TEAMSNAP_SCOPES,
    state,
  });

  return `${TEAMSNAP_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(
  code: string,
  config: OAuthConfig
): Promise<TokenResponse> {
  const response = await fetch(TEAMSNAP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return response.json() as Promise<TokenResponse>;
}

export async function startOAuthFlow(config: OAuthConfig): Promise<{
  authUrl: string;
  waitForCallback: () => Promise<StoredCredentials>;
}> {
  const state = randomBytes(16).toString("hex");
  const authUrl = generateAuthUrl(config, state);

  const waitForCallback = (): Promise<StoredCredentials> => {
    return new Promise((resolve, reject) => {
      const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || "/", `http://localhost:${OAUTH_CALLBACK_PORT}`);

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400);
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400);
          res.end("State mismatch - possible CSRF attack");
          server.close();
          reject(new Error("State mismatch"));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("No authorization code received");
          server.close();
          reject(new Error("No authorization code"));
          return;
        }

        try {
          const tokens = await exchangeCodeForToken(code, config);

          const credentials: StoredCredentials = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
          };

          // Save credentials
          saveCredentials(credentials);

          // Reload client credentials
          teamsnapClient.reloadCredentials();

          // Try to get user info to store
          try {
            const user = await teamsnapClient.getMe();
            credentials.teamsnapUserId = String(user.id);
            credentials.teamsnapEmail = String(user.email || "");
            saveCredentials(credentials);
          } catch {
            // User info is optional, continue without it
          }

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1 style="color: #22c55e;">Successfully Connected!</h1>
                <p>TeamSnap MCP is now authenticated.</p>
                <p>You can close this window and return to Claude.</p>
              </body>
            </html>
          `);

          server.close();
          resolve(credentials);
        } catch (err) {
          res.writeHead(500);
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1 style="color: #ef4444;">Authentication Failed</h1>
                <p>${err instanceof Error ? err.message : "Unknown error"}</p>
                <p>Please try again.</p>
              </body>
            </html>
          `);
          server.close();
          reject(err);
        }
      });

      server.listen(OAUTH_CALLBACK_PORT, () => {
        // Server is ready
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error("OAuth flow timed out after 5 minutes"));
      }, 5 * 60 * 1000);
    });
  };

  return { authUrl, waitForCallback };
}
