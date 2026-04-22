import { API_BASE } from "./endpoints.js";
import type { CollectionItem, CollectionResponse, Link, ParsedItem, CollectionErrorResponse } from "./types.js";

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
      throw new Error("reauthentication_required: Your TeamSnap session is invalid or lacks the required scope. Please run teamsnap_auth to reconnect.");
    }

    if (!response.ok) {
      const text = await response.text();
      let detail = text;
      try {
        const parsed = JSON.parse(text) as CollectionErrorResponse;
        const err = parsed.collection?.error;
        if (err?.title || err?.message) {
          detail = [err.title, err.message].filter(Boolean).join(": ");
        }
      } catch {
        // Non-JSON error body; keep raw text
      }
      throw new Error(`TeamSnap API error (${response.status}): ${detail}`);
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

  async write(
    method: "POST" | "PATCH",
    endpoint: string,
    fields: Record<string, unknown>
  ): Promise<ParsedItem> {
    const template = {
      template: {
        data: Object.entries(fields).map(([name, value]) => ({ name, value })),
      },
    };
    const data = await this.request<CollectionResponse>(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });
    const first = data.collection.items?.[0];
    if (!first) {
      throw new Error(`Write to ${endpoint} succeeded (${method}) but returned no item`);
    }
    return parseCollectionItem(first);
  }
}
