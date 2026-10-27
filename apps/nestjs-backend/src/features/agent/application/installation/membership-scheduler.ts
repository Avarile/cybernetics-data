import { AGENT_ROBOT_ID } from '@cybernetics/core';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { CacheService } from '../../../../cache/cache.service';
import { AUDIT_PORT, type IAuditPort } from '../../domain/ports';
import { AGENT_INSTALLATION_ID } from '../../infrastructure/agent-home';
import { AgentMembershipService } from './membership';

export const MEMBERSHIP_TICK_SECONDS = 15 * 60;

/**
 * Every 15 minutes, makes the Agent space's members the instance admins again (current-design
 * §6 D4). The installation check does this too, but only when someone uses the agent; an admin
 * flag removed in the database would otherwise leave that user in the space. A plain timer, like
 * the email sync scheduler, so it works without Redis; one tick lock serves all instances.
 */
@Injectable()
export class AgentMembershipScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentMembershipScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly membership: AgentMembershipService,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.error(`Agent membership tick failed: ${error}`));
    }, MEMBERSHIP_TICK_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Reconciles when the agent is enabled; returns what changed, or undefined when skipped. */
  async tick() {
    const lock = 'lock:agent-membership:tick' as const;
    if (!(await this.cacheService.setnx(lock, 'tick', MEMBERSHIP_TICK_SECONDS - 5))) return;
    const row = await this.prismaService.agentInstallation.findUnique({
      where: { id: AGENT_INSTALLATION_ID },
      select: { enabled: true, spaceId: true, baseId: true },
    });
    if (!row?.enabled || !row.spaceId || !row.baseId) return;
    const changes = await this.membership.reconcile(row.spaceId, row.baseId);
    if (changes.added.length || changes.removed.length) {
      this.logger.log(`Agent space members reconciled: ${JSON.stringify(changes)}`);
      await this.audit.append({
        runId: 'installation',
        actorUserId: AGENT_ROBOT_ID,
        tool: 'installation.membership',
        args: { reason: 'schedule' },
        resultSummary: JSON.stringify({ added: changes.added, removed: changes.removed }),
        status: 'ok',
        durationMs: 0,
      });
    }
    return changes;
  }
}
