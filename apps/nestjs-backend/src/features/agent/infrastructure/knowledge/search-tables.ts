import { AGENT_ROBOT_ID } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { detectTableProfile } from '../../../ai-data/ai-data.schema';
import type { ISearchScope } from '../../domain/entities';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { AGENT_INSTALLATION_ID } from '../agent-home';
import { AgentExecutionContext } from '../execution-context';

const cacheMs = 30_000;
const idPage = 500;

/** The collections kept in sync from tables (design §11.3, current-design §4.3). */
export type IDerivedCollection = 'kb_records' | 'records' | 'agent_memory';
export const RECORD_COLLECTIONS: IDerivedCollection[] = ['kb_records', 'records'];
export const DERIVED_COLLECTIONS: IDerivedCollection[] = ['kb_records', 'records', 'agent_memory'];

export interface ISearchSettings {
  /** The Agent space: none of its bases is searched as data (a reset may leave old ones). */
  agentSpaceId: string | null;
  setupTableId: string | null;
  memoryTableId: string | null;
  memoryWatch: Set<string>;
  /** Configured knowledge tables; empty means detect them. */
  knowledgeTables: Set<string>;
  scope: ISearchScope;
  /** Base or table ids never indexed. */
  exclude: Set<string>;
}

export interface ISearchTarget {
  collectionId: IDerivedCollection;
  baseId: string;
  /** Fields whose change matters; null means any field. */
  watch: Set<string> | null;
}

/**
 * Which tables feed search and into which collection (current-design §4.4): the memory table into
 * agent_memory; knowledge tables (configured in agent_setup.knowledge_tables, or detected: a
 * primary field plus a text field named "context") into kb_records; with search_scope `all`,
 * every other table outside the Agent space and search_exclude into records. Tables are known by
 * id only, so renames never matter. Shared by the record-event sync and the table sync.
 */
@Injectable()
export class SearchTables {
  private settings?: { at: number; value: ISearchSettings | null };
  private readonly targets = new Map<string, { at: number; value: ISearchTarget | null }>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly execution: AgentExecutionContext,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {}

  /** Forget cached settings and table profiles (setup or schema changed). */
  invalidate() {
    this.settings = undefined;
    this.targets.clear();
  }

  /** Null while the agent is not enabled. */
  async currentSettings() {
    if (!this.settings || Date.now() - this.settings.at > cacheMs) {
      this.settings = { at: Date.now(), value: await this.loadSettings() };
    }
    return this.settings.value;
  }

  async targetFor(tableId: string): Promise<ISearchTarget | null> {
    const settings = await this.currentSettings();
    if (!settings) return null;
    const hit = this.targets.get(tableId);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
    const value = await this.resolve(tableId, settings);
    this.targets.set(tableId, { at: Date.now(), value });
    return value;
  }

  /** Every table that feeds search, across all live bases. */
  async allTargets(): Promise<(ISearchTarget & { tableId: string; dbTableName: string })[]> {
    if (!(await this.currentSettings())) return [];
    const tables = await this.prismaService.tableMeta.findMany({
      where: { deletedTime: null, base: { deletedTime: null, space: { deletedTime: null } } },
      select: { id: true, dbTableName: true },
    });
    const out = [];
    for (const t of tables) {
      const target = await this.targetFor(t.id);
      if (target) out.push({ ...target, tableId: t.id, dbTableName: t.dbTableName });
    }
    return out;
  }

  /** Current table and base names (looked up when needed, so renames show at once). */
  async names(tableIds: string[]) {
    const rows = tableIds.length
      ? await this.prismaService.tableMeta.findMany({
          where: { id: { in: tableIds } },
          select: { id: true, name: true, base: { select: { name: true } } },
        })
      : [];
    return new Map(rows.map((r) => [r.id, { table: r.name, base: r.base.name }]));
  }

  /** The physical table of a live table, or undefined. */
  async dbTableName(tableId: string) {
    const table = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    return table?.dbTableName;
  }

  /** Record ids of a table, a page at a time. */
  async *recordIds(dbTableName: string): AsyncGenerator<string[]> {
    const [schema, table] = dbTableName.split('.');
    const quoted = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    for (let offset = 0; ; offset += idPage) {
      const rows = await this.dataPrismaService.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "__id" AS id FROM ${quoted} ORDER BY "__auto_number" LIMIT ${idPage} OFFSET ${offset}`
      );
      if (rows.length) yield rows.map((r) => r.id);
      if (rows.length < idPage) return;
    }
  }

  private async loadSettings(): Promise<ISearchSettings | null> {
    const row = await this.prismaService.agentInstallation.findUnique({
      where: { id: AGENT_INSTALLATION_ID },
    });
    if (!row?.enabled) return null;
    const tableMap = JSON.parse(row.tableMap || '{}') as Record<string, string>;
    const fieldMap = JSON.parse(row.fieldMap || '{}') as Record<string, Record<string, string>>;
    const memoryFields = fieldMap[AGENT_TABLES.memory] ?? {};
    const profile = await this.execution
      .run({ runId: 'knowledge-sync', actorUserId: AGENT_ROBOT_ID }, () =>
        this.store.getDefaultProfile()
      )
      .catch(() => undefined);
    return {
      agentSpaceId: row.spaceId,
      setupTableId: tableMap[AGENT_TABLES.setup] ?? null,
      memoryTableId: tableMap[AGENT_TABLES.memory] ?? null,
      memoryWatch: new Set(
        ['title', 'content', 'is_active'].map((k) => memoryFields[k]).filter(Boolean)
      ),
      knowledgeTables: new Set(profile?.knowledgeTables ?? []),
      scope: profile?.searchScope ?? 'all',
      exclude: new Set(profile?.searchExclude ?? []),
    };
  }

  private async resolve(tableId: string, settings: ISearchSettings): Promise<ISearchTarget | null> {
    const table = await this.prismaService.tableMeta.findFirst({
      where: {
        id: tableId,
        deletedTime: null,
        base: { deletedTime: null, space: { deletedTime: null } },
      },
      select: { baseId: true, base: { select: { spaceId: true } } },
    });
    if (!table) return null;
    if (tableId === settings.memoryTableId) {
      return { collectionId: 'agent_memory', baseId: table.baseId, watch: settings.memoryWatch };
    }
    // the agent's own tables are never searched as data
    if (table.base.spaceId === settings.agentSpaceId) return null;
    if (settings.exclude.has(tableId) || settings.exclude.has(table.baseId)) return null;

    const fields = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, type: true, isPrimary: true, isComputed: true },
    });
    const profile = detectTableProfile(
      fields.map((f) => ({
        ...f,
        isPrimary: Boolean(f.isPrimary),
        isComputed: Boolean(f.isComputed),
      }))
    );
    const configured = settings.knowledgeTables.size > 0;
    const knowledge = configured
      ? settings.knowledgeTables.has(tableId)
      : Boolean(profile.titleFieldId && profile.contextFieldId);
    if (knowledge) {
      const watch = profile.contextFieldId
        ? new Set(
            [profile.titleFieldId, profile.contextFieldId, profile.softDeleteFieldId].filter(
              (id): id is string => Boolean(id)
            )
          )
        : null;
      return { collectionId: 'kb_records', baseId: table.baseId, watch };
    }
    if (settings.scope === 'all')
      return { collectionId: 'records', baseId: table.baseId, watch: null };
    return null;
  }
}
