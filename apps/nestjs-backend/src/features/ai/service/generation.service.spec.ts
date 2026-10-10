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
      expect.objectContaining({ agentId: reactiveAgent, resourceId: 'usr1' }),
      response
    );
  });

  it('still allows the RAG agent for a read-only user', async () => {
    const { service, viaMastra } = createService(['record|read']);
    await service.generateStream('bse1', request('knowledge-manager-rag'), response);
    expect(viaMastra).toHaveBeenCalledTimes(1);
  });
});
