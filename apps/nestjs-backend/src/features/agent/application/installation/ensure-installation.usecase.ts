import { AGENT_ROBOT_ID, generateSpaceId, HttpErrorCode } from '@cybernetics/core';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentInstallation } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { CacheService } from '../../../../cache/cache.service';
import { SecretsConfig, type ISecretsConfig } from '../../../../configs/secrets.config';
import { CustomHttpException } from '../../../../custom.exception';
import { BaseService } from '../../../base/base.service';
import { FieldOpenApiService } from '../../../field/open-api/field-open-api.service';
import { SchemaPackInstallerService } from '../../../schema-pack/schema-pack.installer';
import { SpaceService } from '../../../space/space.service';
import { AUDIT_PORT, type IAuditPort } from '../../domain/ports';
import { AGENT_INSTALLATION_ID } from '../../infrastructure/agent-home';
import { AgentExecutionContext } from '../../infrastructure/execution-context';
import { AGENT_SEED_VERSION } from '../../pack/agent-defaults';
import { AGENT_PACK_VERSION, getAgentPackCatalog } from '../../pack/agent-pack';
import { AgentSeeder } from './agent-seeder';
import { AgentExposureService, type IRevokedExposure } from './exposure';
import { AgentMembershipService } from './membership';
import type { IActualTable, IFieldMap, ITableMap, IVerifyResult } from './pack-verify';
import { needsRepair, verifyAgainstPack } from './pack-verify';

const freshMs = 5 * 60 * 1000;
const lockKey = 'lock:agent-installation' as const;
const lockTtlSeconds = 300;

export type IInstallationStatus = 'needs_setup' | 'ok' | 'repairing' | 'error' | 'disabled';

export interface IAgentInstallationView {
  enabled: boolean;
  status: IInstallationStatus;
  spaceId: string | null;
  baseId: string | null;
  tableMap: ITableMap;
  fieldMap: IFieldMap;
  lastVerifiedTime: string | null;
  lastError: string | null;
  health: Record<string, unknown> | null;
}

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const toInstallationView = (row: AgentInstallation | null): IAgentInstallationView => ({
  enabled: Boolean(row?.enabled),
  status: (row ? (row.enabled ? row.status : 'disabled') : 'needs_setup') as IInstallationStatus,
  spaceId: row?.spaceId ?? null,
  baseId: row?.baseId ?? null,
  tableMap: parse(row?.tableMap, {}),
  fieldMap: parse(row?.fieldMap, {}),
  lastVerifiedTime: row?.lastVerifiedTime?.toISOString() ?? null,
  lastError: row?.lastError ?? null,
  health: parse(row?.health, null),
});

const notReady = (view: IAgentInstallationView) =>
  new CustomHttpException(
    view.enabled
      ? `Agent needs setup: ${view.lastError ?? view.status}`
      : 'The agent is not enabled. An admin can enable it in Admin > Agent.',
    HttpErrorCode.CONFLICT
  );

/**
 * Creates, checks and repairs the Agent space, the Agent base and its tables (design §7.1, §7.4).
 * Runs on enable, on boot, and lazily before a turn when the last check is older than 5 minutes.
 * Repairs are additive only: nothing is deleted or retyped, and admin-added columns are kept.
 */
@Injectable()
export class EnsureInstallation implements OnApplicationBootstrap {
  private readonly logger = new Logger(EnsureInstallation.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly membership: AgentMembershipService,
    private readonly seeder: AgentSeeder,
    private readonly exposure: AgentExposureService,
    private readonly installer: SchemaPackInstallerService,
    private readonly spaceService: SpaceService,
    private readonly baseService: BaseService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly execution: AgentExecutionContext,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort,
    @SecretsConfig() private readonly secretsConfig: ISecretsConfig
  ) {}

  onApplicationBootstrap() {
    void this.load()
      .then((row) => (row?.enabled ? this.ensure('boot') : undefined))
      .catch((error) => this.logger.error(`Agent installation check failed: ${error}`));
  }

  async status(): Promise<IAgentInstallationView> {
    return toInstallationView(await this.load());
  }

  /** The installation, checked within the last 5 minutes; throws 409 when the agent cannot run. */
  async ensureFresh(): Promise<IAgentInstallationView> {
    const row = await this.load();
    const fresh =
      row?.enabled &&
      row.status === 'ok' &&
      row.lastVerifiedTime &&
      Date.now() - row.lastVerifiedTime.getTime() < freshMs;
    const view = fresh ? toInstallationView(row) : await this.ensure('lazy');
    if (!view.enabled || view.status !== 'ok') throw notReady(view);
    return view;
  }

  /**
   * Turn the agent on. The first time, creates the Agent space (owned by the enabling admin) and
   * the Agent base. Must run in the admin's request context: space and base record their creator.
   */
  async enable(actorUserId: string): Promise<IAgentInstallationView> {
    const row = await this.load();
    if (!(row && (await this.isAlive(row)))) {
      await this.createHome(actorUserId, row);
    }
    await this.prismaService.agentInstallation.update({
      where: { id: AGENT_INSTALLATION_ID },
      data: { enabled: true },
    });
    return this.ensure('enable', actorUserId);
  }

  async disable(actorUserId: string): Promise<IAgentInstallationView> {
    await this.prismaService.agentInstallation.updateMany({
      where: { id: AGENT_INSTALLATION_ID },
      data: { enabled: false },
    });
    await this.auditEvent(actorUserId, 'installation.disable', {}, 'disabled');
    return this.status();
  }

  /** Start over with a new, empty Agent base (the old one stays in the space or the trash). */
  async reset(actorUserId: string): Promise<IAgentInstallationView> {
    const row = await this.load();
    const spaceAlive =
      row?.spaceId &&
      (await this.prismaService.space.findFirst({
        where: { id: row.spaceId, deletedTime: null },
        select: { id: true },
      }));
    if (row && spaceAlive) {
      const base = await this.baseService.createBase({ spaceId: row.spaceId!, name: 'Agent' });
      await this.prismaService.agentInstallation.update({
        where: { id: AGENT_INSTALLATION_ID },
        data: { baseId: base.id, tableMap: '{}', fieldMap: '{}', seededVersion: 0, enabled: true },
      });
    } else {
      await this.createHome(actorUserId, row);
      await this.prismaService.agentInstallation.update({
        where: { id: AGENT_INSTALLATION_ID },
        data: { enabled: true },
      });
    }
    await this.auditEvent(actorUserId, 'installation.reset', {}, 'new Agent base');
    return this.ensure('reset', actorUserId);
  }

  /** Check and repair everything; returns the resulting state. Never throws for a broken install. */
  async ensure(reason: string, actorUserId = AGENT_ROBOT_ID): Promise<IAgentInstallationView> {
    if (!(await this.cacheService.setnx(lockKey, reason, lockTtlSeconds))) {
      return { ...(await this.status()), status: 'repairing' };
    }
    const started = Date.now();
    try {
      const row = await this.load();
      if (!row?.enabled) return toInstallationView(row);
      if (!(await this.isAlive(row))) {
        return this.save({
          status: 'needs_setup',
          lastError:
            'The Agent base or space is missing or in the trash. Restore it, or reset the agent.',
        });
      }
      return await this.check(row, reason, actorUserId, started);
    } catch (error) {
      this.logger.error(`Agent installation (${reason}) failed: ${(error as Error).stack}`);
      return this.save({ status: 'error', lastError: (error as Error).message.slice(0, 500) });
    } finally {
      await this.cacheService.del(lockKey);
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async check(
    row: AgentInstallation,
    reason: string,
    actorUserId: string,
    started: number
  ): Promise<IAgentInstallationView> {
    const spaceId = row.spaceId!;
    const baseId = row.baseId!;
    const runScope = { runId: `installation-${started}`, actorUserId };
    const members = await this.membership.reconcile(spaceId, baseId);
    const revoked = await this.execution.run(runScope, () => this.exposure.revoke(spaceId));
    const catalog = getAgentPackCatalog();
    const stored = { tableMap: parse(row.tableMap, {}), fieldMap: parse(row.fieldMap, {}) };

    let verified = verifyAgainstPack(catalog, await this.readBase(baseId), stored);
    const repaired = { tables: verified.missingTables, fields: verified.missingFields };
    if (needsRepair(verified)) {
      if (verified.detached.length) {
        // Move the dead columns aside (their data stays) so the planner can rebuild the link.
        await this.execution.run(runScope, () => this.moveAside(verified.detached));
        verified = verifyAgainstPack(catalog, await this.readBase(baseId), {
          tableMap: verified.tableMap,
          fieldMap: verified.fieldMap,
        });
      }
      await this.execution.run(runScope, () =>
        this.installer.installCatalog({
          baseId,
          catalog,
          packs: ['agent'],
          options: { timezone: 'UTC', currency: 'USD', starterRows: false, optionalTables: [] },
          existing: verified.existing,
        })
      );
      verified = verifyAgainstPack(catalog, await this.readBase(baseId), {
        tableMap: verified.tableMap,
        fieldMap: verified.fieldMap,
      });
      if (needsRepair(verified)) {
        const missing = [...verified.missingTables, ...verified.missingFields].join(', ');
        throw new Error(`Agent tables are still incomplete after repair: ${missing}`);
      }
    }

    let seeded: { setup: number; skills: number } | undefined;
    if (row.seededVersion < AGENT_SEED_VERSION) {
      seeded = await this.execution.run(runScope, () =>
        this.seeder.seed(verified.tableMap, verified.fieldMap)
      );
    }

    const health = this.health(verified, members, repaired, revoked, seeded);
    const changed =
      members.added.length +
      members.removed.length +
      repaired.tables.length +
      repaired.fields.length +
      revoked.invitations +
      revoked.baseShares +
      revoked.viewShares;
    if (changed || seeded?.skills || seeded?.setup) {
      await this.auditEvent(actorUserId, 'installation.ensure', { reason }, JSON.stringify(health));
    }
    return this.save({
      status: 'ok',
      lastError: null,
      tableMap: JSON.stringify(verified.tableMap),
      fieldMap: JSON.stringify(verified.fieldMap),
      packVersion: AGENT_PACK_VERSION,
      ...(seeded ? { seededVersion: AGENT_SEED_VERSION } : {}),
      health: JSON.stringify(health),
      lastVerifiedTime: new Date(),
    });
  }

  private health(
    verified: IVerifyResult,
    members: { admins: string[]; added: string[]; removed: string[] },
    repaired: { tables: string[]; fields: string[] },
    revoked: IRevokedExposure,
    seeded?: { setup: number; skills: number }
  ) {
    return {
      checkedAt: new Date().toISOString(),
      admins: members.admins.length,
      membership: { added: members.added, removed: members.removed },
      repaired,
      revoked,
      renamed: verified.renamed,
      mismatched: verified.mismatched,
      seeded: seeded ?? null,
      secretsKeyConfigured: Boolean(this.secretsConfig.encryptionKey),
    };
  }

  private async moveAside(detached: IVerifyResult['detached']) {
    for (const { tableId, fieldId, name } of detached) {
      await this.fieldOpenApiService.updateField(tableId, fieldId, { name: `${name} (detached)` });
    }
  }

  private async readBase(baseId: string): Promise<IActualTable[]> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true, name: true },
    });
    const fields = await this.prismaService.field.findMany({
      where: { tableId: { in: tables.map((t) => t.id) }, deletedTime: null },
      select: { id: true, name: true, type: true, isLookup: true, tableId: true },
    });
    return tables.map((t) => ({ ...t, fields: fields.filter((f) => f.tableId === t.id) }));
  }

  private async isAlive(row: AgentInstallation) {
    if (!row.spaceId || !row.baseId) return false;
    const [space, base] = await Promise.all([
      this.prismaService.space.findFirst({ where: { id: row.spaceId, deletedTime: null } }),
      this.prismaService.base.findFirst({
        where: { id: row.baseId, spaceId: row.spaceId, deletedTime: null },
      }),
    ]);
    return Boolean(space && base);
  }

  private async createHome(actorUserId: string, row: AgentInstallation | null) {
    const space = await this.spaceService.createSpaceByParams({
      id: generateSpaceId(),
      name: 'Agent',
      createdBy: actorUserId,
    });
    const base = await this.baseService.createBase({ spaceId: space.id, name: 'Agent' });
    const data = {
      spaceId: space.id,
      baseId: base.id,
      tableMap: '{}',
      fieldMap: '{}',
      seededVersion: 0,
      status: 'needs_setup',
    };
    await this.prismaService.agentInstallation.upsert({
      where: { id: AGENT_INSTALLATION_ID },
      create: { id: AGENT_INSTALLATION_ID, createdBy: actorUserId, ...data },
      update: data,
    });
    if (row) this.logger.warn(`Agent home recreated (previous base ${row.baseId} is not usable)`);
    await this.auditEvent(actorUserId, 'installation.create', data, `space ${space.id}`);
  }

  private load() {
    return this.prismaService.agentInstallation.findUnique({
      where: { id: AGENT_INSTALLATION_ID },
    });
  }

  private async save(data: Partial<AgentInstallation>) {
    const row = await this.prismaService.agentInstallation.update({
      where: { id: AGENT_INSTALLATION_ID },
      data,
    });
    return toInstallationView(row);
  }

  private async auditEvent(actorUserId: string, tool: string, args: unknown, summary: string) {
    await this.audit.append({
      runId: 'installation',
      actorUserId,
      tool,
      args,
      resultSummary: summary,
      status: 'ok',
      durationMs: 0,
    });
  }
}
