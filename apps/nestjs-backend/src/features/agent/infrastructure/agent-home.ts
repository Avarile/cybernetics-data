import { HttpErrorCode } from '@cybernetics/core';
import type { Prisma, PrismaClient } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../../custom.exception';

/** The single `agent_installation` row. */
export const AGENT_INSTALLATION_ID = 'agent';
export const AGENT_MANAGED_MESSAGE = 'Managed by the Agent';

type IPrisma = Pick<
  PrismaClient | Prisma.TransactionClient,
  'agentInstallation' | 'base' | 'tableMeta'
>;

export interface IAgentHomeRef {
  spaceId?: string | null;
  baseId?: string | null;
  tableId?: string | null;
}

/**
 * Whether a space, base or table belongs to the Agent space (design §7.1). Every base in that
 * space counts, including one left behind by a reset. Uses Prisma only, so any module can call it
 * without depending on the agent module.
 */
export async function isAgentHome(prisma: IPrisma, ref: IAgentHomeRef): Promise<boolean> {
  const home = await prisma.agentInstallation.findUnique({
    where: { id: AGENT_INSTALLATION_ID },
    select: { spaceId: true },
  });
  if (!home?.spaceId) return false;
  if (ref.spaceId) return ref.spaceId === home.spaceId;

  let baseId = ref.baseId;
  if (!baseId && ref.tableId) {
    const table = await prisma.tableMeta.findUnique({
      where: { id: ref.tableId },
      select: { baseId: true },
    });
    baseId = table?.baseId;
  }
  if (!baseId) return false;
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { spaceId: true } });
  return base?.spaceId === home.spaceId;
}

/** Refuse sharing, inviting, publishing and moving for the Agent space with 403. */
export async function assertNotAgentHome(prisma: IPrisma, ...refs: IAgentHomeRef[]) {
  for (const ref of refs) {
    if (await isAgentHome(prisma, ref)) {
      throw new CustomHttpException(AGENT_MANAGED_MESSAGE, HttpErrorCode.RESTRICTED_RESOURCE);
    }
  }
}
