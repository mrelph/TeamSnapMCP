import { API_BASE } from "./endpoints.js";
import type { CollectionItem, CollectionResponse, Link, ParsedItem } from "./types.js";

export interface CoreCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  clientSecret: string;
}

export interface CoreOptions {
  getCredentials: () => CoreCredentials | null;
  onRefresh: () => Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null>;
}

export function parseCollectionItem(item: CollectionItem): ParsedItem {
  const result: ParsedItem = {};
  for (const { name, value } of item.data) {
    result[name] = value;
  }
  result._href = item.href;
  result._links = item.links;
  return result;
}

export class TeamSnapCore {
  constructor(private readonly opts: CoreOptions) {}

  private getCreds(): CoreCredentials {
    const creds = this.opts.getCredentials();
    if (!creds || !creds.accessToken) {
      throw new Error("Not authenticated. Please run teamsnap_auth first.");
    }
    return creds;
  }

  async request<T>(endpointOrUrl: string, options: RequestInit = {}, _retried = false): Promise<T> {
    const creds = this.getCreds();
    const url = endpointOrUrl.startsWith("http") ? endpointOrUrl : `${API_BASE}${endpointOrUrl}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (response.status === 401 && !_retried) {
      const refreshed = await this.opts.onRefresh();
      if (refreshed) {
        return this.request<T>(endpointOrUrl, options, true);
      }
      throw new Error("Session expired. Please re-authenticate with teamsnap_auth.");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TeamSnap API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async searchMany(endpointOrUrl: string): Promise<ParsedItem[]> {
    const data = await this.request<CollectionResponse>(endpointOrUrl);
    return (data.collection.items ?? []).map(parseCollectionItem);
  }

  async searchOne(endpointOrUrl: string): Promise<ParsedItem | null> {
    const data = await this.request<CollectionResponse>(endpointOrUrl);
    const first = data.collection.items?.[0];
    return first ? parseCollectionItem(first) : null;
  }

  followLink(resource: { _links?: Link[] }, rel: string): string | null {
    const link = resource._links?.find((l) => l.rel === rel);
    return link?.href ?? null;
  }
}
