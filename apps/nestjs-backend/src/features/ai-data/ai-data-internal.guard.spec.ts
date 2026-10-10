/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AI_DATA_CONTEXT_HEADER, AiDataInternalGuard } from './ai-data-internal.guard';

const claims = { userId: 'usr1', baseId: 'bse1', exp: 9e9 };

const build = (opts: { enabled?: boolean; check?: any; serviceKey?: string } = {}) => {
  const contextService = {
    enabled: opts.enabled ?? true,
    check: vi.fn(opts.check ?? (async () => ({ ok: true, claims }))),
  };
  const guard = new AiDataInternalGuard(
    { serviceKey: 'serviceKey' in opts ? opts.serviceKey : 'mastra-key' } as any,
    contextService as any
  );
  return { guard, contextService };
};

const ctx = (headers: Record<string, string | undefined>) => {
  const req: any = { headers };
  return {
    req,
    context: { switchToHttp: () => ({ getRequest: () => req }) } as any,
  };
};

const goodHeaders = { authorization: 'Bearer mastra-key', [AI_DATA_CONTEXT_HEADER]: 'v1.x.y' };

describe('AiDataInternalGuard', () => {
  it('lets a valid call through and attaches the context claims', async () => {
    const { guard, contextService } = build();
    const { req, context } = ctx(goodHeaders);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(contextService.check).toHaveBeenCalledWith('v1.x.y');
    expect(req.aiDataContext).toEqual(claims);
  });

  it('answers 404 while the feature is not configured', async () => {
    await expect(
      build({ enabled: false }).guard.canActivate(ctx(goodHeaders).context)
    ).rejects.toThrow(NotFoundException);
    await expect(
      build({ serviceKey: undefined }).guard.canActivate(ctx(goodHeaders).context)
    ).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['no authorization', { [AI_DATA_CONTEXT_HEADER]: 'v1.x.y' }],
    ['wrong key', { ...goodHeaders, authorization: 'Bearer nope' }],
    ['wrong scheme', { ...goodHeaders, authorization: 'Basic mastra-key' }],
    ['key prefix only', { ...goodHeaders, authorization: 'Bearer mastra' }],
  ])('rejects a caller that is not the Mastra service: %s', async (_label, headers) => {
    const { guard, contextService } = build();
    await expect(guard.canActivate(ctx(headers as any).context)).rejects.toThrow(
      UnauthorizedException
    );
    expect(contextService.check).not.toHaveBeenCalled();
  });

  it.each(['malformed', 'unknown', 'expired', 'disabled'])(
    'rejects a %s context with 401 and attaches nothing',
    async (reason) => {
      const { guard } = build({ check: async () => ({ ok: false, reason }) });
      const { req, context } = ctx(goodHeaders);
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(req.aiDataContext).toBeUndefined();
    }
  );
});
