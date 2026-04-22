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
const idempotencyCache = new Map<string, { result: unknown; expiresAt: number }>();

export function checkIdempotency(key: string | undefined): unknown | null {
  if (!key) return null;
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry.result;
}

export function storeIdempotency(key: string | undefined, result: unknown): void {
  if (!key) return;
  idempotencyCache.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

export function __clearIdempotencyCache(): void {
  idempotencyCache.clear();
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
