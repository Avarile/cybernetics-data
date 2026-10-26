/* eslint-disable @typescript-eslint/naming-convention */
const SECRET_KEY_PATTERN = /api[-_]?key|secret|token|password|authorization|cookie|credential/i;
const MAX_STRING = 2_000;
const MAX_JSON = 8_000;

/** Replace values under secret-looking keys and cut long strings, for logs and the audit trail. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[${value.length}]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1),
      ])
    );
  }
  return value;
}

/** JSON for the audit row, capped at 8 KB. */
export function auditJson(value: unknown): string {
  const json = JSON.stringify(redact(value)) ?? 'null';
  return json.length > MAX_JSON ? `${json.slice(0, MAX_JSON)}…` : json;
}
