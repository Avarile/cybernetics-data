import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { ICockpitBasesVo, ICockpitTablesVo, ISetDefaultBaseVo } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import {
  AGENT_STORE_PORT,
  AUDIT_PORT,
  COCKPIT_DATA_PORT,
  SCHEMA_CATALOG_PORT,
  type IAgentStorePort,
  type IAuditPort,
  type ICockpitDataPort,
  type ISchemaCatalogPort,
} from '../../domain/ports';
import { systemTable } from '../../domain/search/schema';

export const cockpitNotFound = (what: string) =>
  new CustomHttpException(`${what} not found`, HttpErrorCode.NOT_FOUND);

/**
 * Scope design §5: the bases the cockpit can show, the tables of one, and the default base,
 * which is agent_setup.data_base_id: the cockpit starts on it and the agent's searches read it.
 */
@Injectable()
export class CockpitScope {
  constructor(
    @Inject(COCKPIT_DATA_PORT) private readonly data: ICockpitDataPort,
    @Inject(SCHEMA_CATALOG_PORT) private readonly catalog: ISchemaCatalogPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort
  ) {}

  async bases(): Promise<ICockpitBasesVo> {
    const profile = await this.store.getDefaultProfile().catch(() => undefined);
    const [bases, base] = await Promise.all([
      this.data.listBases(),
      this.catalog.dataBase(profile?.dataBaseId ?? null),
    ]);
    const defaultBaseId = base && bases.some((b) => b.id === base.id) ? base.id : null;
    return { bases, defaultBaseId };
  }

  async tables(baseId: string): Promise<ICockpitTablesVo> {
    if (!(await this.data.base(baseId))) throw cockpitNotFound('Base');
    await this.data.assertAllowed(baseId, ['table|read']);
    const schema = await this.catalog.schema(baseId);
    return {
      baseId,
      tables: schema.tables
        .filter((t) => !systemTable.test(t.name))
        .map((t) => ({ id: t.id, name: t.name })),
    };
  }

  async setDefault(actorUserId: string, baseId: string): Promise<ISetDefaultBaseVo> {
    if (!(await this.data.base(baseId))) throw cockpitNotFound('Base');
    await this.data.assertAllowed(baseId, ['record|read']);
    const profile = await this.store.getDefaultProfile();
    if (!profile) {
      throw new CustomHttpException(
        'The agent has no profile yet: install it in Admin ▸ Agent',
        HttpErrorCode.CONFLICT
      );
    }
    await this.store.updateProfile(profile.id, { dataBaseId: baseId });
    await this.audit.append({
      runId: 'admin',
      actorUserId,
      tool: 'cockpit.default_base',
      args: { baseId },
      resultSummary: baseId,
      status: 'ok',
      durationMs: 0,
    });
    return { defaultBaseId: baseId };
  }
}
