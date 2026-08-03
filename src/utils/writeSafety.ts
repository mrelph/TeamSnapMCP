export interface CollectionJsonTemplate {
  template: { data: Array<{ name: string; value: unknown }> };
}

export function buildTemplate(fields: Record<string, unknown>): CollectionJsonTemplate {
  const data: Array<{ name: string; value: unknown }> = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    data.push({ name, value });
  }
  return { template: { data } };
}

const IDEMPOTENCY_TTL_MS = 60_000;
const IDEMPOTENCY_MAX_ENTRIES = 500;
const idempotencyCache = new Map<string, { result: unknown; expiresAt: number }>();

/** Key-order-independent serialisation, so `{a,b}` and `{b,a}` fingerprint identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Identifies *which operation* an idempotency key refers to.
 *
 * The caller-supplied key alone is not enough. Keys are model-generated and collide
 * readily ("1", "retry", "key"), and the cache is process-global across every write
 * tool. Without this scope, reusing a key for a different member — or a different
 * tool entirely — replays the first call's result and reports success while the
 * requested write never happens. For a permission change that means truthfully
 * answering "access revoked" when it was not.
 *
 * Folding tool, target and payload into the key means a reused key with different
 * arguments simply misses the cache and executes normally, which is the safe
 * direction. Only a genuine retry — same tool, same target, same payload — dedupes.
 */
export function idempotencyScope(tool: string, target: string, payload: unknown): string {
  return `${tool}\u0000${target}\u0000${stableStringify(payload)}`;
}

function scopedKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

export function checkIdempotency(scope: string, key: string | undefined): unknown | null {
  if (!key) return null;
  const k = scopedKey(scope, key);
  const entry = idempotencyCache.get(k);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(k);
    return null;
  }
  return entry.result;
}

export function storeIdempotency(scope: string, key: string | undefined, result: unknown): void {
  if (!key) return;
  // Entries are only ever reclaimed on lookup, so a long-lived stdio process would
  // otherwise accumulate one per distinct key forever. Sweep expired entries, then
  // bound the map outright.
  if (idempotencyCache.size >= IDEMPOTENCY_MAX_ENTRIES) {
    const now = Date.now();
    for (const [existing, entry] of idempotencyCache) {
      if (now > entry.expiresAt) idempotencyCache.delete(existing);
    }
    while (idempotencyCache.size >= IDEMPOTENCY_MAX_ENTRIES) {
      const oldest = idempotencyCache.keys().next();
      if (oldest.done) break;
      idempotencyCache.delete(oldest.value);
    }
  }
  idempotencyCache.set(scopedKey(scope, key), {
    result,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

export function __clearIdempotencyCache(): void {
  idempotencyCache.clear();
}

export function __idempotencyCacheSize(): number {
  return idempotencyCache.size;
}

export type ConfirmCheck = { ok: true } | { ok: false; reason: string };

export function requireConfirm(args: { confirm?: unknown }): ConfirmCheck {
  if (args.confirm === true) return { ok: true };
  return {
    ok: false,
    reason:
      "This is a destructive action. Pass confirm: true to proceed. Run the tool once with preview: true (default) to inspect the payload first.",
  };
}
