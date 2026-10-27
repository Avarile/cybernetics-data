import type { PrismaService } from '@teable/db-main-prisma';
import type { CacheService } from '../../../../cache/cache.service';
import type { IAuditPort } from '../../domain/ports';
import type { AgentMembershipService } from './membership';
import { AgentMembershipScheduler } from './membership-scheduler';

const setup = (opts: {
  locked?: boolean;
  row?: { enabled: boolean; spaceId: string | null; baseId: string | null } | null;
  removed?: string[];
}) => {
  const reconcile = vi.fn(async () => ({
    admins: ['usrA'],
    added: [],
    removed: opts.removed ?? [],
  }));
  const append = vi.fn(async () => undefined);
  const scheduler = new AgentMembershipScheduler(
    {
      agentInstallation: { findUnique: async () => opts.row ?? null },
    } as unknown as PrismaService,
    { setnx: async () => !opts.locked } as unknown as CacheService,
    { reconcile } as unknown as AgentMembershipService,
    { append } as IAuditPort
  );
  return { scheduler, reconcile, append };
};

const enabled = { enabled: true, spaceId: 'spcAgent', baseId: 'bseAgent' };

describe('AgentMembershipScheduler', () => {
  it('reconciles the Agent space and audits a removal', async () => {
    const { scheduler, reconcile, append } = setup({ row: enabled, removed: ['user:usrB'] });
    expect(await scheduler.tick()).toMatchObject({ removed: ['user:usrB'] });
    expect(reconcile).toHaveBeenCalledWith('spcAgent', 'bseAgent');
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'installation.membership' })
    );
  });

  it('audits nothing when nothing changed', async () => {
    const { scheduler, append } = setup({ row: enabled });
    await scheduler.tick();
    expect(append).not.toHaveBeenCalled();
  });

  it('skips while another instance holds the tick, and while the agent is off', async () => {
    for (const opts of [
      { locked: true, row: enabled },
      { row: { ...enabled, enabled: false } },
      { row: null },
    ]) {
      const { scheduler, reconcile } = setup(opts);
      expect(await scheduler.tick()).toBeUndefined();
      expect(reconcile).not.toHaveBeenCalled();
    }
  });
});
