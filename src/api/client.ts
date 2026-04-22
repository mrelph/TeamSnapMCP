import { OAUTH_REDIRECT_URI } from "../utils/config.js";
import { loadCredentials, saveCredentials, type StoredCredentials } from "../utils/storage.js";
import { TeamSnapCore, type CoreCredentials } from "./core.js";
import { ENDPOINTS, TOKEN_URL } from "./endpoints.js";
import type { ParsedItem } from "./types.js";

export class TeamSnapClient {
  private credentials: StoredCredentials | null = null;
  private readonly core: TeamSnapCore;

  constructor() {
    this.credentials = loadCredentials();
    this.core = new TeamSnapCore({
      getCredentials: () => this.toCoreCredentials(),
      onRefresh: () => this.refreshToken(),
    });
  }

  private toCoreCredentials(): CoreCredentials | null {
    if (!this.credentials) return null;
    return {
      accessToken: this.credentials.accessToken,
      refreshToken: this.credentials.refreshToken,
      expiresAt: this.credentials.expiresAt,
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
    };
  }

  isAuthenticated(): boolean {
    return this.credentials !== null && !!this.credentials.accessToken;
  }

  reloadCredentials(): void {
    this.credentials = loadCredentials();
  }

  private async refreshToken(): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null> {
    if (!this.credentials?.refreshToken) return null;
    try {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.credentials.refreshToken,
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          redirect_uri: OAUTH_REDIRECT_URI,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
      this.credentials = {
        ...this.credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.credentials.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
      saveCredentials(this.credentials);
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: this.credentials.expiresAt,
      };
    } catch {
      return null;
    }
  }

  getCore(): TeamSnapCore {
    return this.core;
  }

  async getMe(): Promise<ParsedItem> {
    const result = await this.core.searchOne(ENDPOINTS.me);
    if (!result) throw new Error("No user data returned");
    return result;
  }

  async getTeams(): Promise<ParsedItem[]> {
    let userId = this.credentials?.teamsnapUserId;
    if (!userId) {
      const me = await this.getMe();
      userId = String(me.id);
    }
    return this.core.searchMany(`${ENDPOINTS.teams}?user_id=${userId}`);
  }

  async getTeam(teamId: string): Promise<ParsedItem> {
    const team = await this.core.searchOne(`${ENDPOINTS.teams}?id=${teamId}`);
    if (!team) throw new Error(`Team ${teamId} not found`);
    return team;
  }

  async getTeamMembers(teamId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`);
  }

  async getTeamEvents(teamId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.events}?team_id=${teamId}`);
  }

  async getEvent(eventId: string): Promise<ParsedItem> {
    const event = await this.core.searchOne(`${ENDPOINTS.events}?id=${eventId}`);
    if (!event) throw new Error(`Event ${eventId} not found`);
    return event;
  }

  async getAvailabilities(eventId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.availabilities}?event_id=${eventId}`);
  }

  async getMemberAvailabilities(memberId: string): Promise<ParsedItem[]> {
    return this.core.searchMany(`${ENDPOINTS.availabilities}?member_id=${memberId}`);
  }
}

export const teamsnapClient = new TeamSnapClient();
