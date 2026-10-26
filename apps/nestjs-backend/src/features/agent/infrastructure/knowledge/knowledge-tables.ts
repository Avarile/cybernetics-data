import { AGENT_ROBOT_ID } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { detectTableProfile } from '../../../ai-data/ai-data.schema';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { AGENT_INSTALLATION_ID } from '../agent-home';
import { AgentExecutionContext } from '../execution-context';

const cacheMs = 30_000;
const idPage = 1000;

export interface IKnowledgeSettings {
  agentBaseId: string | null;
  memoryTableId: string | null;
  memoryWatch: Set<string>;
  setupTableId: string | null;
  embeddingFieldId: string | null;
  /** Configured knowledge tables; empty means detect them. */
  knowledgeTables: Set<string>;
}

export interface IKnowledgeTarget {
  collectionId: 'kb_records' | 'agent_memory';
  baseId: string;
  /** Fields whose change matters; null means any field. */
  watch: Set<string> | null;
}

/**
 * Which tables feed the derived collections (design §11.3): agent_memory, and the knowledge
 * tables (configured in agent_setup.knowledge_tables, or detected: a primary field plus a text
 * field named "context"). Shared by the record-event sync and the full sync.
 */
@Injectable()
export class KnowledgeTables {
  private settings?: { at: number; value: IKnowledgeSettings | null };
  private readonly targets = new Map<string, { at: number; value: IKnowledgeTarget | null }>();

  constructor(
    private readonly prismaService: PrismaService,
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

  async targetFor(tableId: string): Promise<IKnowledgeTarget | null> {
    const settings = await this.currentSettings();
    if (!settings) return null;
    const hit = this.targets.get(tableId);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
    const value = await this.resolve(tableId, settings);
    this.targets.set(tableId, { at: Date.now(), value });
    return value;
  }

  /** Every table that feeds a derived collection, across all live bases. */
  async allTargets(): Promise<(IKnowledgeTarget & { tableId: string; dbTableName: string })[]> {
    if (!(await this.currentSettings())) return [];
    const tables = await this.prismaService.tableMeta.findMany({
      where: { deletedTime: null, base: { deletedTime: null } },
      select: { id: true, dbTableName: true },
    });
    const out = [];
    for (const t of tables) {
      const target = await this.targetFor(t.id);
      if (target) out.push({ ...target, tableId: t.id, dbTableName: t.dbTableName });
    }
    return out;
  }

  /** Record ids of a table, a page at a time. */
  async *recordIds(dbTableName: string): AsyncGenerator<string[]> {
    const [schema, table] = dbTableName.split('.');
    const quoted = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    for (let offset = 0; ; offset += idPage) {
      const rows = await this.prismaService.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "__id" AS id FROM ${quoted} ORDER BY "__auto_number" LIMIT ${idPage} OFFSET ${offset}`
      );
      if (rows.length) yield rows.map((r) => r.id);
      if (rows.length < idPage) return;
    }
  }

  private async loadSettings(): Promise<IKnowledgeSettings | null> {
    const row = await this.prismaService.agentInstallation.findUnique({
      where: { id: AGENT_INSTALLATION_ID },
    });
    if (!row?.enabled) return null;
    const tableMap = JSON.parse(row.tableMap || '{}') as Record<string, string>;
    const fieldMap = JSON.parse(row.fieldMap || '{}') as Record<string, Record<string, string>>;
    const memoryFields = fieldMap[AGENT_TABLES.memory] ?? {};
    const setupFields = fieldMap[AGENT_TABLES.setup] ?? {};
    const profile = await this.execution
      .run({ runId: 'knowledge-sync', actorUserId: AGENT_ROBOT_ID }, () =>
        this.store.getDefaultProfile()
      )
      .catch(() => undefined);
    return {
      agentBaseId: row.baseId,
      memoryTableId: tableMap[AGENT_TABLES.memory] ?? null,
      memoryWatch: new Set(
        ['title', 'content', 'is_active'].map((k) => memoryFields[k]).filter(Boolean)
      ),
      knowledgeTables: new Set(profile?.knowledgeTables ?? []),
      setupTableId: tableMap[AGENT_TABLES.setup] ?? null,
      embeddingFieldId: setupFields.embedding_model ?? null,
    };
  }

  private async resolve(
    tableId: string,
    settings: IKnowledgeSettings
  ): Promise<IKnowledgeTarget | null> {
    const table = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { baseId: true },
    });
    if (!table) return null;
    if (tableId === settings.memoryTableId) {
      return { collectionId: 'agent_memory', baseId: table.baseId, watch: settings.memoryWatch };
    }
    // the agent's own tables are never knowledge tables
    if (table.baseId === settings.agentBaseId) return null;
    const configured = settings.knowledgeTables.size > 0;
    if (configured && !settings.knowledgeTables.has(tableId)) return null;

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
    if (!configured && !(profile.titleFieldId && profile.contextFieldId)) return null;
    const watch = profile.contextFieldId
      ? new Set(
          [profile.titleFieldId, profile.contextFieldId, profile.softDeleteFieldId].filter(
            (id): id is string => Boolean(id)
          )
        )
      : null;
    return { collectionId: 'kb_records', baseId: table.baseId, watch };
  }
}
