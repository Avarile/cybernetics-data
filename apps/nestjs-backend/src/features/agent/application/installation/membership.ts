import { AGENT_ROBOT_ID, Role } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PrincipalType } from '@teable/openapi';

export interface ICollaboratorRow {
  id: string;
  principalId: string;
  principalType: string;
  resourceType: string;
  roleName: string;
}

export interface IMembershipPlan {
  /** Admin user ids to add as space owners. */
  add: string[];
  /** Collaborator rows to remove (non-admins, departments, base-level grants, non-owner admins). */
  remove: ICollaboratorRow[];
}

/**
 * The Agent space belongs to the instance admins and nobody else: every admin is a space owner,
 * and every other grant (non-admin users, departments, base-level collaborators) is removed.
 */
export function planMembership(adminIds: string[], rows: ICollaboratorRow[]): IMembershipPlan {
  const admins = new Set(adminIds);
  const ownerRows = rows.filter(
    (r) =>
      r.resourceType === CollaboratorType.Space &&
      r.principalType === PrincipalType.User &&
      admins.has(r.principalId) &&
      r.roleName === Role.Owner
  );
  const owners = new Set(ownerRows.map((r) => r.principalId));
  return {
    add: adminIds.filter((id) => !owners.has(id)),
    remove: rows.filter((r) => !ownerRows.includes(r)),
  };
}

@Injectable()
export class AgentMembershipService {
  constructor(private readonly prismaService: PrismaService) {}

  async adminIds(): Promise<string[]> {
    const users = await this.prismaService.user.findMany({
      // `NOT: { isSystem: true }` would also drop NULL rows (SQL NOT on NULL), i.e. every real user.
      where: {
        isAdmin: true,
        deactivatedTime: null,
        deletedTime: null,
        OR: [{ isSystem: null }, { isSystem: false }],
      },
      select: { id: true },
      orderBy: { createdTime: 'asc' },
    });
    return users.map((u) => u.id);
  }

  /** Make the space's members exactly the instance admins. Returns what changed. */
  async reconcile(spaceId: string, baseId: string) {
    const adminIds = await this.adminIds();
    const rows = await this.prismaService.collaborator.findMany({
      where: { resourceId: { in: [spaceId, baseId] } },
      select: {
        id: true,
        principalId: true,
        principalType: true,
        resourceType: true,
        roleName: true,
      },
    });
    const plan = planMembership(adminIds, rows);
    if (plan.remove.length) {
      // resourceId in the where clause lets the collaborator cache middleware clear the cache.
      await this.prismaService.collaborator.deleteMany({
        where: { id: { in: plan.remove.map((r) => r.id) }, resourceId: { in: [spaceId, baseId] } },
      });
    }
    if (plan.add.length) {
      await this.prismaService.collaborator.createMany({
        data: plan.add.map((principalId) => ({
          resourceType: CollaboratorType.Space,
          resourceId: spaceId,
          principalId,
          principalType: PrincipalType.User,
          roleName: Role.Owner,
          createdBy: AGENT_ROBOT_ID,
        })),
        skipDuplicates: true,
      });
    }
    return {
      admins: adminIds,
      added: plan.add,
      removed: plan.remove.map((r) => `${r.principalType}:${r.principalId}`),
    };
  }
}
