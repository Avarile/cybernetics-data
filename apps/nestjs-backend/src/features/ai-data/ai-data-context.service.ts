import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { AiDataConfig, type IAiDataConfig } from '../../configs/ai-data.config';
import { signAiDataContext, verifyAiDataContext } from './ai-data-context';
import type { IAiDataContextClaims } from './ai-data-context';

export type IAiDataContextCheck =
  | { ok: true; claims: IAiDataContextClaims }
  | { ok: false; reason: 'disabled' | 'malformed' | 'bad-signature' | 'expired' | 'revoked' };

/**
 * Issues and checks the signed user context the Mastra service uses to call the
 * internal ai-data endpoint.
 *
 * A context is live from issue() until revoke() (end of the chat turn) or its
 * expiry, whichever comes first. Liveness is kept in the shared cache, so a
 * revoked context is rejected on every backend replica, and a captured context
 * cannot be replayed after the turn that produced it.
 */
@Injectable()
export class AiDataContextService {
  constructor(
    @AiDataConfig() private readonly config: IAiDataConfig,
    private readonly cacheService: CacheService
  ) {}

  /** The internal endpoint only exists when both secrets are configured. */
  get enabled(): boolean {
    return Boolean(this.config.contextSecret && this.config.serviceKey);
  }

  async issue(userId: string, baseId: string): Promise<{ token: string; requestId: string }> {
    if (!this.config.contextSecret) {
      throw new Error('AI_DATA_CONTEXT_SECRET is not set');
    }
    const requestId = randomUUID();
    const ttl = this.config.contextTtlSeconds;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    await this.cacheService.setDetail(`ai-data:context:${requestId}`, true, ttl);
    const token = signAiDataContext({ userId, baseId, requestId, exp }, this.config.contextSecret);
    return { token, requestId };
  }

  async revoke(requestId: string): Promise<void> {
    await this.cacheService.del(`ai-data:context:${requestId}`);
  }

  async check(token: unknown): Promise<IAiDataContextCheck> {
    if (!this.enabled || !this.config.contextSecret) return { ok: false, reason: 'disabled' };
    const verified = verifyAiDataContext(token, this.config.contextSecret);
    if (!verified.ok) return verified;
    const live = await this.cacheService.get(`ai-data:context:${verified.claims.requestId}`);
    if (!live) return { ok: false, reason: 'revoked' };
    return verified;
  }
}
