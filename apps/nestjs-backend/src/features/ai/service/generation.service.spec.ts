/* eslint-disable @typescript-eslint/no-explicit-any, sonarjs/no-duplicate-string */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GenerationService } from './generation.service';

const createService = (permissions: string[]) => {
  const service = Object.create(GenerationService.prototype) as GenerationService;
  const viaMastra = vi.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    cls: { get: (key: string) => (key === 'user' ? { id: 'usr1' } : undefined) },
    permissionService: { getPermissions: vi.fn().mockResolvedValue(permissions) },
    generateStreamViaMastra: viaMastra,
  });
  return { service, viaMastra };
};

const request = (agentId: string) => ({
  agentId,
  messages: [{ role: 'user' as const, content: 'hi' }],
});
const response = {} as never;
const reactiveAgent = 'knowledge-manager-reactive';

describe('GenerationService.generateStream agent gating', () => {
  it('rejects an unknown agentId', async () => {
    const { service, viaMastra } = createService(['record|create']);
    await expect(service.generateStream('bse1', request('../admin'), response)).rejects.toThrow(
      BadRequestException
    );
    expect(viaMastra).not.toHaveBeenCalled();
  });

  it.each(['knowledge-manager-non-rag', reactiveAgent])(
    'forbids %s without record write permission',
    async (agentId) => {
      const { service, viaMastra } = createService(['record|read']);
      await expect(service.generateStream('bse1', request(agentId), response)).rejects.toThrow(
        ForbiddenException
      );
      expect(viaMastra).not.toHaveBeenCalled();
    }
  );

  it('routes the reactive agent for a writer and forces resourceId to the session user', async () => {
    const { service, viaMastra } = createService(['record|update']);
    await service.generateStream('bse1', request(reactiveAgent), response);
    expect(viaMastra).toHaveBeenCalledWith(
      'bse1',
      expect.objectContaining({ agentId: reactiveAgent, resourceId: 'usr1' }),
      response,
      true
    );
  });

  it('still allows the RAG agent for a read-only user', async () => {
    const { service, viaMastra } = createService(['record|read']);
    await service.generateStream('bse1', request('knowledge-manager-rag'), response);
    expect(viaMastra).toHaveBeenCalledTimes(1);
  });
});

describe('GenerationService Mastra path: AI data context', () => {
  const makeResponse = () => {
    const written: string[] = [];
    return {
      written,
      res: {
        headersSent: false,
        on: vi.fn(),
        off: vi.fn(),
        writeHead: vi.fn(function (this: { headersSent: boolean }) {
          this.headersSent = true;
        }),
        write: vi.fn((chunk: string) => written.push(chunk)),
        end: vi.fn(),
      },
    };
  };

  const createMastraService = (opts: { enabled: boolean; fail?: boolean }) => {
    const service = Object.create(GenerationService.prototype) as GenerationService;
    const streamAgent = vi.fn(async function* () {
      if (opts.fail) throw new Error('mastra down');
      yield 'hello';
    });
    const aiDataContextService = {
      enabled: opts.enabled,
      issue: vi.fn(async () => ({ token: 'opaque-token' })),
      revoke: vi.fn(async () => undefined),
    };
    Object.assign(service, {
      cls: { get: (key: string) => (key === 'user' ? { id: 'usr1' } : undefined) },
      permissionService: { getPermissions: vi.fn().mockResolvedValue(['record|read']) },
      mastraClientService: { streamAgent, getThread: vi.fn() },
      aiDataContextService,
      logger: { error: vi.fn(), warn: vi.fn() },
    });
    return { service, streamAgent, aiDataContextService };
  };

  const ragRequest = { ...request('knowledge-manager-rag'), threadId: undefined };

  it('issues a context for the session user and base, passes it as requestContext, then revokes it', async () => {
    const { service, streamAgent, aiDataContextService } = createMastraService({ enabled: true });
    (service as any).mastraClientService.createThread = vi.fn(async () => ({ id: 'thr1' }));
    const { res, written } = makeResponse();

    await service.generateStream('bse1', ragRequest as never, res as never);

    expect(aiDataContextService.issue).toHaveBeenCalledWith('usr1', 'bse1');
    const body = (streamAgent.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    // read-only user: canWrite false gates the RAG ingest tools in Mastra
    expect(body.requestContext).toEqual({ aiDataContext: 'opaque-token', canWrite: false });
    expect(aiDataContextService.revoke).toHaveBeenCalledWith('opaque-token');
    expect(written.join('')).toContain('hello');
  });

  it('tells Mastra the user can write when they hold a record write permission', async () => {
    const { service, streamAgent } = createMastraService({ enabled: true });
    (service as any).permissionService.getPermissions = vi
      .fn()
      .mockResolvedValue(['record|read', 'record|create']);
    (service as any).mastraClientService.createThread = vi.fn(async () => ({ id: 'thr1' }));
    const { res } = makeResponse();

    await service.generateStream('bse1', ragRequest as never, res as never);
    const body = (streamAgent.mock.calls[0] as unknown[])[1] as Record<string, any>;
    expect(body.requestContext.canWrite).toBe(true);
  });

  it('revokes the context even when the agent fails', async () => {
    const { service, aiDataContextService } = createMastraService({ enabled: true, fail: true });
    (service as any).mastraClientService.createThread = vi.fn(async () => ({ id: 'thr1' }));
    const { res } = makeResponse();

    await service.generateStream('bse1', ragRequest as never, res as never);
    expect(aiDataContextService.revoke).toHaveBeenCalledWith('opaque-token');
  });

  it('sends no data token, only canWrite, when the feature is not configured', async () => {
    const { service, streamAgent, aiDataContextService } = createMastraService({ enabled: false });
    (service as any).mastraClientService.createThread = vi.fn(async () => ({ id: 'thr1' }));
    const { res } = makeResponse();

    await service.generateStream('bse1', ragRequest as never, res as never);
    expect(aiDataContextService.issue).not.toHaveBeenCalled();
    const body = (streamAgent.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(body.requestContext).toEqual({ canWrite: false });
  });
});
