import { TeamSnapCore, type CoreCredentials } from "../../src/api/core.js";
import { ENDPOINTS, TOKEN_URL } from "../../src/api/endpoints.js";
import type { ParsedItem } from "../../src/api/types.js";
import { loadCredentials, saveCredentials, type StoredCredentials } from "./dynamodb.js";

export class TeamSnapClient {
  private credentials: StoredCredentials | null = null;
  private readonly core: TeamSnapCore;

  constructor() {
    this.core = new TeamSnapCore({
      getCredentials: () => this.toCoreCredentials(),
      onRefresh: () => this.refreshToken(),
    });
  }

  async loadCredentials(): Promise<void> {
    this.credentials = await loadCredentials();
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
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
      const updated: StoredCredentials = {
        ...this.credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.credentials.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
      await saveCredentials(updated);
      this.credentials = updated;
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: updated.expiresAt,
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
    const me = await this.getMe();
    return this.core.searchMany(`${ENDPOINTS.teams}?user_id=${me.id}`);
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
