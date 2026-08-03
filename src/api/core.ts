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

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Turns an auth/scope rejection on a write into the actionable message the README
 * promises, instead of TeamSnap's opaque wording.
 *
 * Tokens issued before this server gained write support carry `read` scope only.
 * TeamSnap then answers a write with 403 ("...provided the appropriate scopes...")
 * — not 401 — so it never reaches the refresh-and-retry path, and refreshing would
 * not help anyway: a refresh preserves the original scope. The only fix is a new
 * consent, so say so.
 */
function describeAuthFailure(status: number, method: string, detail: string): string | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null;
  const mentionsScope = /scope/i.test(detail);
  if (status === 403 && !mentionsScope) return null;
  if (status !== 401 && status !== 403) return null;
  return (
    `reauthentication_required: TeamSnap rejected this write (${status}). ` +
    "Your token was most likely issued with `read` scope only — tokens predating write " +
    "support cannot be upgraded by a refresh. Run teamsnap_auth to reconnect and grant " +
    `\`read write\`. Reads continue to work meanwhile. TeamSnap said: ${detail}`
  );
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
      const scopeHint = describeAuthFailure(response.status, String(options.method ?? "GET"), detail);
      throw new Error(scopeHint ?? `TeamSnap API error (${response.status}): ${detail}`);
    }

    const text = await response.text();
    if (text.trim() === "") {
      // Returning `undefined as T` here would be a type lie: every caller is typed
      // Collection+JSON and would fault on `.collection` with no compile-time signal.
      // Name the case instead — a bodiless 2xx means the write LANDED.
      throw new Error(
        `TeamSnap returned an empty body for ${endpointOrUrl} (status ${response.status}). ` +
          "The request succeeded but no Collection+JSON document came back."
      );
    }
    return JSON.parse(text) as T;
  }

  /**
   * Issues a request whose success carries no body — DELETE answers 204.
   * Shares the auth/refresh/error handling of request() but never parses.
   */
  private async requestVoid(endpoint: string, options: RequestInit = {}, _retried = false): Promise<number> {
    const creds = this.getCreds();
    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

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
      if (refreshed) return this.requestVoid(endpoint, options, true);
      throw new Error("reauthentication_required: Your TeamSnap session is invalid or lacks the required scope. Please run teamsnap_auth to reconnect.");
    }

    if (!response.ok) {
      const body = await response.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body) as CollectionErrorResponse;
        const err = parsed.collection?.error;
        if (err?.title || err?.message) detail = [err.title, err.message].filter(Boolean).join(": ");
      } catch {
        // Non-JSON error body; keep raw text
      }
      const scopeHint = describeAuthFailure(response.status, String(options.method ?? "GET"), detail);
      throw new Error(scopeHint ?? `TeamSnap API error (${response.status}): ${detail}`);
    }

    return response.status;
  }

  /** DELETE a resource. Returns the HTTP status so callers can report what happened. */
  async remove(endpoint: string): Promise<number> {
    return this.requestVoid(endpoint, { method: "DELETE" });
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
