import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';

/**
 * A signed statement from the backend: "this request acts as user U in base B until exp".
 * The Mastra service forwards it on every data call but cannot create or change one,
 * because it never holds the signing secret.
 *
 * Format: v1.<base64url(JSON claims)>.<base64url(HMAC-SHA256("v1.<payload>"))>
 */
export interface IAiDataContextClaims {
  userId: string;
  baseId: string;
  requestId: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export type IAiDataContextVerifyResult =
  | { ok: true; claims: IAiDataContextClaims }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

const contextVersion = 'v1';

const claimsSchema = z
  .object({
    userId: z.string().startsWith('usr'),
    baseId: z.string().startsWith('bse'),
    requestId: z.string().min(16),
    exp: z.number().int().positive(),
  })
  .strict();

const hmac = (data: string, secret: string) =>
  createHmac('sha256', secret).update(data).digest('base64url');

export function signAiDataContext(claims: IAiDataContextClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claimsSchema.parse(claims))).toString('base64url');
  const signed = `${contextVersion}.${payload}`;
  return `${signed}.${hmac(signed, secret)}`;
}

export function verifyAiDataContext(
  token: unknown,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): IAiDataContextVerifyResult {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== contextVersion) return { ok: false, reason: 'malformed' };

  const [version, payload, signature] = parts;
  const expected = Buffer.from(hmac(`${version}.${payload}`, secret));
  const given = Buffer.from(signature);
  // Check the signature before parsing anything the caller controls.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let claims: IAiDataContextClaims;
  try {
    claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
