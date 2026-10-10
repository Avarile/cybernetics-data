import { timingSafeEqual } from 'crypto';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AiDataConfig, type IAiDataConfig } from '../../configs/ai-data.config';
import type { IAiDataContextClaims } from './ai-data-context';
import { AiDataContextService } from './ai-data-context.service';

export const AI_DATA_CONTEXT_HEADER = 'x-ai-data-context';

export type IAiDataInternalRequest = Request & { aiDataContext?: IAiDataContextClaims };

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * Guards the internal ai-data endpoint. Two checks, both required:
 * 1. the caller is the Mastra service (bearer MASTRA_API_KEY), and
 * 2. it presents a live context signed by this backend, which names the user and base.
 * The endpoint answers 404 while either secret is unset, so it does not exist by default.
 */
@Injectable()
export class AiDataInternalGuard implements CanActivate {
  private readonly logger = new Logger(AiDataInternalGuard.name);

  constructor(
    @AiDataConfig() private readonly config: IAiDataConfig,
    private readonly contextService: AiDataContextService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.contextService.enabled || !this.config.serviceKey) {
      throw new NotFoundException();
    }
    const req = context.switchToHttp().getRequest<IAiDataInternalRequest>();

    const [scheme, key] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !key || !safeEqual(key, this.config.serviceKey)) {
      throw new UnauthorizedException();
    }

    const result = await this.contextService.check(req.headers[AI_DATA_CONTEXT_HEADER]);
    if (!result.ok) {
      this.logger.warn(`Rejected AI data context: ${result.reason}`);
      throw new UnauthorizedException('Invalid AI data context');
    }
    req.aiDataContext = result.claims;
    return true;
  }
}
