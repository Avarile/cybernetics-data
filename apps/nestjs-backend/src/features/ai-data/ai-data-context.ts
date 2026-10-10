import { createHash, randomBytes } from 'crypto';

/**
 * The AI data context is an opaque random token. It means "this chat turn acts as
 * user U in base B" only because the backend stored that against it in the shared
 * cache. The Mastra service forwards the token but cannot create or change one:
 * it would have to guess 256 random bits.
 *
 * The cache is keyed by a hash of the token, so reading the cache does not reveal
 * usable tokens.
 */
export interface IAiDataContextClaims {
  userId: string;
  baseId: string;
  /** Expiry, seconds since epoch. The cache TTL enforces it too. */
  exp: number;
}

const tokenBytes = 32;
// base64url of 32 bytes, no padding
const tokenPattern = /^[\w-]{43}$/;

export function generateAiDataContextToken(): string {
  return randomBytes(tokenBytes).toString('base64url');
}

export function isWellFormedAiDataContextToken(token: unknown): token is string {
  return typeof token === 'string' && tokenPattern.test(token);
}

export function aiDataContextCacheKey(token: string): `ai-data:context:${string}` {
  return `ai-data:context:${createHash('sha256').update(token).digest('hex')}`;
}
