import { randomUUID } from 'crypto';
import { HttpErrorCode } from '@cybernetics/core';
import type { Logger } from '@nestjs/common';
import type { RedisNativeService } from '../../cache/redis-native.service';
import { CustomHttpException } from '../../custom.exception';

// eslint-disable-next-line @typescript-eslint/naming-convention
const LOCK_TTL_SECONDS = 300;
/** Thrown by RedisNativeService when the cache provider is not Redis at all. */
// eslint-disable-next-line @typescript-eslint/naming-convention
const NO_REDIS = 'Redis is not available';

/**
 * One install per base at a time. A same-process Set always applies; a Redis SET NX EX also
 * covers other instances when Redis is the cache provider. Returns the release function.
 */
export class SchemaPackInstallLock {
  private readonly held = new Set<string>();

  constructor(
    private readonly redis: RedisNativeService,
    private readonly logger: Logger
  ) {}

  async acquire(baseId: string): Promise<() => Promise<void>> {
    const busy = () =>
      new CustomHttpException(
        'Schema packs are already being added to this base; try again shortly',
        HttpErrorCode.CONFLICT
      );
    if (this.held.has(baseId)) throw busy();
    this.held.add(baseId);
    const key = `schema-pack:install-lock:${baseId}`;
    const token = randomUUID();
    let viaRedis = false;
    try {
      if (!(await this.redis.setnxex(key, LOCK_TTL_SECONDS, token))) {
        this.held.delete(baseId);
        throw busy();
      }
      viaRedis = true;
    } catch (error) {
      if (error instanceof CustomHttpException) throw error;
      const message = (error as Error).message;
      if (message.includes(NO_REDIS)) {
        // Memory cache, single process: the in-process guard is the lock.
        this.logger.debug(`Schema pack install lock without Redis: ${message}`);
      } else {
        // Redis is configured but failing: other instances are no longer excluded.
        this.logger.warn(`Schema pack install lock fell back to this process only: ${message}`);
      }
    }
    return async () => {
      this.held.delete(baseId);
      if (!viaRedis) return;
      try {
        if ((await this.redis.get(key)) === token) await this.redis.del(key);
      } catch {
        // The TTL frees it.
      }
    };
  }
}
