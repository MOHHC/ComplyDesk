const SENSITIVE_FIELDS = new Set(['password', 'passwordHash', 'token', 'accessToken']);
const NOISY_FIELDS = new Set(['tenantId', 'updatedAt']);

function serialize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

/**
 * Shallow field-by-field diff between two plain rows (or null for a
 * create/delete's missing side). Returns null rather than {} when nothing
 * differs, so callers can tell "no diff" from "diff computed as empty".
 */
export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { before: unknown; after: unknown }> | null {
  if (!before && !after) return null;

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff: Record<string, { before: unknown; after: unknown }> = {};

  for (const key of keys) {
    if (SENSITIVE_FIELDS.has(key) || NOISY_FIELDS.has(key)) continue;
    const b = serialize(before?.[key]);
    const a = serialize(after?.[key]);
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diff[key] = { before: b, after: a };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

/** Redacts request-body fields that should never be persisted verbatim
 * into an audit row, for the generic (no @Audit model) fallback path. */
export function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of SENSITIVE_FIELDS) {
    if (field in clone) clone[field] = '[redacted]';
  }
  return clone;
}
