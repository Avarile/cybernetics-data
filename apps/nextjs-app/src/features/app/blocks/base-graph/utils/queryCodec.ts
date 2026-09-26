import type { IBaseGraphQueryRo } from '@teable/openapi';
import { baseGraphQueryRoSchema } from '@teable/openapi';

/** Above this the URL gets unwieldy; the UI saves a local preset instead. */
export const MAX_ENCODED_QUERY_LENGTH = 6144;

/**
 * Drops `undefined` and `false` so the URL carries only what was set. Empty
 * arrays are kept: `linkFieldIds: []` (no links) differs from omitting it (all).
 */
const stripDefaults = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripDefaults);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (inner === undefined || inner === false) continue;
      out[key] = stripDefaults(inner);
    }
    return out;
  }
  return value;
};

/** Key order is part of JSON.stringify's output; sort it so equal queries hash equal. */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

export const normaliseQuery = (ro: IBaseGraphQueryRo): IBaseGraphQueryRo =>
  sortKeys(stripDefaults(ro)) as IBaseGraphQueryRo;

/** Stable identity for the react-query key: equal queries, equal hash. */
export const queryHash = (ro: IBaseGraphQueryRo): string => JSON.stringify(normaliseQuery(ro));

const toBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (encoded: string): string => {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const encodeQuery = (ro: IBaseGraphQueryRo): string =>
  toBase64Url(JSON.stringify(normaliseQuery(ro)));

/**
 * Never trusts the URL: anything that does not validate against the same schema
 * the server uses is rejected, and the caller falls back to a preset.
 */
export const decodeQuery = (encoded: string | undefined | null): IBaseGraphQueryRo | null => {
  if (!encoded) return null;
  try {
    const parsed = baseGraphQueryRoSchema.safeParse(JSON.parse(fromBase64Url(encoded)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
