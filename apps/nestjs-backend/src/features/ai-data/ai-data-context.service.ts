import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { AiDataConfig, type IAiDataConfig } from '../../configs/ai-data.config';
import {
  aiDataContextCacheKey,
  generateAiDataContextToken,
  isWellFormedAiDataContextToken,
} from './ai-data-context';
import type { IAiDataContextClaims } from './ai-data-context';

export type IAiDataContextCheck =
  | { ok: true; claims: IAiDataContextClaims }
  | { ok: false; reason: 'disabled' | 'malformed' | 'unknown' | 'expired' };

/**
 * Issues and checks the user context the Mastra service uses to call the internal
 * ai-data endpoint.
 *
 * A context is live from issue() until revoke() (end of the chat turn) or its TTL,
 * whichever comes first. It lives in the shared cache, so every backend replica
 * sees the same state, and a captured token cannot be replayed after its turn.
 */
@Injectable()
export class AiDataContextService {
  constructor(
    @AiDataConfig() private readonly config: IAiDataConfig,
    private readonly cacheService: CacheService
  ) {}

  /** The internal endpoint only exists when the Mastra service key is configured. */
  get enabled(): boolean {
    return Boolean(this.config.serviceKey);
  }

  async issue(userId: string, baseId: string): Promise<{ token: string }> {
    const token = generateAiDataContextToken();
    const ttl = this.config.contextTtlSeconds;
    const claims: IAiDataContextClaims = {
      userId,
      baseId,
      exp: Math.floor(Date.now() / 1000) + ttl,
    };
    await this.cacheService.setDetail(aiDataContextCacheKey(token), claims, ttl);
    return { token };
  }

  async revoke(token: string): Promise<void> {
    if (!isWellFormedAiDataContextToken(token)) return;
    await this.cacheService.del(aiDataContextCacheKey(token));
  }

  async check(token: unknown): Promise<IAiDataContextCheck> {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    if (!isWellFormedAiDataContextToken(token)) return { ok: false, reason: 'malformed' };

    const claims = await this.cacheService.get(aiDataContextCacheKey(token));
    if (!claims) return { ok: false, reason: 'unknown' };
    if (claims.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
    return { ok: true, claims };
  }
}
