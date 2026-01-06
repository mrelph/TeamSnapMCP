import { TEAMSNAP_API_BASE, TEAMSNAP_TOKEN_URL, OAUTH_REDIRECT_URI } from "../utils/config.js";
import { loadCredentials, saveCredentials, type StoredCredentials } from "../utils/storage.js";

// TeamSnap uses Collection+JSON format
interface CollectionItem {
  href: string;
  data: Array<{ name: string; value: unknown }>;
  links?: Array<{ rel: string; href: string }>;
}

interface CollectionResponse {
  collection: {
    version: string;
    href: string;
    items?: CollectionItem[];
    links?: Array<{ rel: string; href: string }>;
    error?: { title: string; message: string };
  };
}

// Helper to convert Collection+JSON items to plain objects
function parseCollectionItem(item: CollectionItem): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { name, value } of item.data) {
    result[name] = value;
  }
  result._href = item.href;
  result._links = item.links;
  return result;
}

export class TeamSnapClient {
  private credentials: StoredCredentials | null = null;

  constructor() {
    this.credentials = loadCredentials();
  }

  isAuthenticated(): boolean {
    return this.credentials !== null && !!this.credentials.accessToken;
  }

  getCredentials(): StoredCredentials | null {
    return this.credentials;
  }

  async refreshTokenIfNeeded(): Promise<boolean> {
    if (!this.credentials) return false;

    // Check if token is expired or will expire in 5 minutes
    if (this.credentials.expiresAt) {
      const fiveMinutes = 5 * 60 * 1000;
      if (Date.now() > this.credentials.expiresAt - fiveMinutes) {
        return this.refreshToken();
      }
    }
    return true;
  }

  private async refreshToken(): Promise<boolean> {
    if (!this.credentials?.refreshToken) return false;

    try {
      const response = await fetch(TEAMSNAP_TOKEN_URL, {
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

      if (!response.ok) return false;

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      this.credentials = {
        ...this.credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || this.credentials.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };

      saveCredentials(this.credentials);
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.credentials?.accessToken) {
      throw new Error("Not authenticated. Please run teamsnap_auth first.");
    }

    await this.refreshTokenIfNeeded();

    const url = endpoint.startsWith("http") ? endpoint : `${TEAMSNAP_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Try refreshing token once
      const refreshed = await this.refreshToken();
      if (refreshed) {
        return this.request(endpoint, options);
      }
      throw new Error("Session expired. Please re-authenticate with teamsnap_auth.");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TeamSnap API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getMe(): Promise<Record<string, unknown>> {
    const data = await this.request<CollectionResponse>("/me");
    if (!data.collection.items?.length) {
      throw new Error("No user data returned");
    }
    return parseCollectionItem(data.collection.items[0]);
  }

  async getTeams(): Promise<Record<string, unknown>[]> {
    const data = await this.request<CollectionResponse>("/teams");
    return (data.collection.items || []).map(parseCollectionItem);
  }

  async getTeam(teamId: string): Promise<Record<string, unknown>> {
    const data = await this.request<CollectionResponse>(`/teams/search?id=${teamId}`);
    if (!data.collection.items?.length) {
      throw new Error(`Team ${teamId} not found`);
    }
    return parseCollectionItem(data.collection.items[0]);
  }

  async getTeamMembers(teamId: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<CollectionResponse>(`/members/search?team_id=${teamId}`);
    return (data.collection.items || []).map(parseCollectionItem);
  }

  async getTeamEvents(teamId: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<CollectionResponse>(`/events/search?team_id=${teamId}`);
    return (data.collection.items || []).map(parseCollectionItem);
  }

  async getEvent(eventId: string): Promise<Record<string, unknown>> {
    const data = await this.request<CollectionResponse>(`/events/search?id=${eventId}`);
    if (!data.collection.items?.length) {
      throw new Error(`Event ${eventId} not found`);
    }
    return parseCollectionItem(data.collection.items[0]);
  }

  async getAvailabilities(eventId: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<CollectionResponse>(`/availabilities/search?event_id=${eventId}`);
    return (data.collection.items || []).map(parseCollectionItem);
  }

  async getMemberAvailabilities(memberId: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<CollectionResponse>(`/availabilities/search?member_id=${memberId}`);
    return (data.collection.items || []).map(parseCollectionItem);
  }

  reloadCredentials(): void {
    this.credentials = loadCredentials();
  }
}

// Singleton instance
export const teamsnapClient = new TeamSnapClient();
