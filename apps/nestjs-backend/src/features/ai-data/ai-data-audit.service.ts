import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { CacheService } from '../../cache/cache.service';
import { AiDataConfig, type IAiDataConfig } from '../../configs/ai-data.config';
import { CustomHttpException } from '../../custom.exception';

export interface IAiDataAuditEntry {
  op: string;
  userId: string;
  baseId: string;
  table?: string;
  /** "internal-api" for the Mastra service, "session" for in-process agents. */
  via: string;
  ok: boolean;
  /** Records returned, when the operation returns records. */
  rows?: number;
  /** HTTP status of a failure. */
  status?: number;
  ms: number;
}

const rateWindowSeconds = 60;

/**
 * Guardrails around AI data access: a per-user rate limit shared by all backend
 * replicas (cache counter), and one structured audit line per call. The audit line
 * carries who read what and how much, never record contents.
 */
@Injectable()
export class AiDataAuditService {
  private readonly logger = new Logger('AiDataAudit');

  constructor(
    @AiDataConfig() private readonly config: IAiDataConfig,
    private readonly cacheService: CacheService
  ) {}

  /** Count this call against the user's per-minute budget; throws 429 when it is spent. */
  async checkRate(userId: string): Promise<void> {
    const limit = this.config.rateLimitPerMinute;
    if (!limit) return;
    const window = Math.floor(Date.now() / 1000 / rateWindowSeconds);
    const count = await this.cacheService.incr(
      `ai-data:rate:${userId}:${window}`,
      rateWindowSeconds * 2
    );
    if (count > limit) {
      this.logger.warn(`AI data rate limit exceeded for user ${userId}: ${count}/${limit}`);
      throw new CustomHttpException(
        `Too many data requests from the assistant (limit ${limit} per minute). Please wait a moment.`,
        HttpErrorCode.TOO_MANY_REQUESTS
      );
    }
  }

  record(entry: IAiDataAuditEntry): void {
    const line = JSON.stringify({ event: 'ai_data_access', ...entry });
    if (entry.ok) this.logger.log(line);
    else this.logger.warn(line);
  }

  static statusOf(error: unknown): number {
    return error instanceof HttpException ? error.getStatus() : 500;
  }

  static rowsOf(result: unknown): number | undefined {
    if (Array.isArray(result)) return result.length;
    const returned = (result as { returned?: unknown } | null)?.returned;
    return typeof returned === 'number' ? returned : undefined;
  }
}
