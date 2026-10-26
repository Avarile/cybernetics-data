import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PerformanceCacheService } from '../../../../performance-cache';
import { generateBaseShareListCacheKey } from '../../../../performance-cache/generate-keys';
import { ViewOpenApiService } from '../../../view/open-api/view-open-api.service';

export interface IRevokedExposure {
  invitations: number;
  baseShares: number;
  viewShares: number;
}

/**
 * Nothing in the Agent space may be reachable from outside it (design §7.4 step 6). The services
 * refuse new invitations and shares; this revokes any that already exist, e.g. created before the
 * lock-down or written straight into the database.
 */
@Injectable()
export class AgentExposureService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly viewOpenApiService: ViewOpenApiService
  ) {}

  /** Must run inside an agent execution context: disabling a view share is a view operation. */
  async revoke(spaceId: string): Promise<IRevokedExposure> {
    const bases = await this.prismaService.base.findMany({
      where: { spaceId },
      select: { id: true },
    });
    const baseIds = bases.map((b) => b.id);

    const invitations = await this.prismaService.invitation.updateMany({
      where: { deletedTime: null, OR: [{ spaceId }, { baseId: { in: baseIds } }] },
      data: { deletedTime: new Date() },
    });

    const shares = await this.prismaService.baseShare.findMany({
      where: { baseId: { in: baseIds }, enabled: true },
      select: { id: true, baseId: true },
    });
    if (shares.length) {
      await this.prismaService.baseShare.updateMany({
        where: { id: { in: shares.map((s) => s.id) } },
        data: { enabled: false },
      });
      for (const baseId of new Set(shares.map((s) => s.baseId))) {
        await this.performanceCacheService.del(generateBaseShareListCacheKey(baseId));
      }
    }

    const views = await this.prismaService.view.findMany({
      where: { enableShare: true, deletedTime: null, table: { baseId: { in: baseIds } } },
      select: { id: true, tableId: true },
    });
    for (const view of views) {
      await this.viewOpenApiService.disableShare(view.tableId, view.id);
    }

    return { invitations: invitations.count, baseShares: shares.length, viewShares: views.length };
  }
}
