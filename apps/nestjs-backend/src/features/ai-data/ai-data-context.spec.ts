import { describe, expect, it } from 'vitest';
import {
  aiDataContextCacheKey,
  generateAiDataContextToken,
  isWellFormedAiDataContextToken,
} from './ai-data-context';

describe('AI data context tokens', () => {
  it('generates 256-bit base64url tokens that are all different', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateAiDataContextToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[\w-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(isWellFormedAiDataContextToken(token)).toBe(true);
    }
  });

  it.each([
    undefined,
    null,
    123,
    '',
    'short',
    'x'.repeat(44),
    `${'a'.repeat(42)}=`,
    `${'a'.repeat(42)}.`,
  ])('rejects malformed input %#', (token) => {
    expect(isWellFormedAiDataContextToken(token)).toBe(false);
  });

  it('keys the cache by a hash, never by the token itself', () => {
    const token = generateAiDataContextToken();
    const key = aiDataContextCacheKey(token);
    expect(key).toMatch(/^ai-data:context:[0-9a-f]{64}$/);
    expect(key).not.toContain(token);
    expect(aiDataContextCacheKey(token)).toBe(key);
    expect(aiDataContextCacheKey(generateAiDataContextToken())).not.toBe(key);
  });
});
