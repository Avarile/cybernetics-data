import { AGENT_ROBOT_ID } from '@cybernetics/core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import { AgentConfig, type IAgentConfig } from '../../../../configs/agent.config';
import {
  Events,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
} from '../../../../event-emitter/events';
import { detectTableProfile } from '../../../ai-data/ai-data.schema';
import { KnowledgeIngest } from '../../application/knowledge/knowledge-ingest';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { AGENT_INSTALLATION_ID } from '../agent-home';
import { AgentExecutionContext } from '../execution-context';

const cacheMs = 30_000;

interface ISyncSettings {
  agentBaseId: string | null;
  memoryTableId: string | null;
  memoryWatch: Set<string>;
  /** Configured knowledge tables; empty means detect them. */
  knowledgeTables: Set<string>;
}

interface ISyncTarget {
  collectionId: 'kb_records' | 'agent_memory';
  baseId: string;
  /** Fields whose change matters; null means any field. */
  watch: Set<string> | null;
}

const asArray = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);

/**
 * Derived sync (design §11.3): record changes in knowledge tables and in agent_memory queue the
 * ingest job of that record; deletes remove its document. Only ids are queued here; the job reads
 * the record. Never fails the write that raised the event.
 */
@Injectable()
export class KnowledgeSyncListener {
  private readonly logger = new Logger(KnowledgeSyncListener.name);
  private settings?: { at: number; value: ISyncSettings | null };
  private readonly targets = new Map<string, { at: number; value: ISyncTarget | null }>();

  constructor(
    private readonly prismaService: PrismaService,
    @AgentConfig() private readonly config: IAgentConfig,
    private readonly ingest: KnowledgeIngest,
    private readonly execution: AgentExecutionContext,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {}

  @OnEvent(Events.TABLE_RECORD_CREATE, { async: true })
  async onCreate(event: RecordCreateEvent) {
    const { tableId, record } = event.payload;
    await this.sync(
      tableId,
      asArray(record).map((r) => r.id),
      event.context.user?.id
    );
  }

  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  async onUpdate(event: RecordUpdateEvent) {
    const { tableId, record } = event.payload;
    await this.sync(tableId, asArray(record), event.context.user?.id);
  }

  @OnEvent(Events.TABLE_RECORD_DELETE, { async: true })
  async onDelete(event: RecordDeleteEvent) {
    const { tableId, recordId } = event.payload;
    await this.sync(tableId, asArray(recordId), event.context.user?.id, true);
  }

  /** Forget cached settings and table profiles (setup or schema changed). */
  invalidate() {
    this.settings = undefined;
    this.targets.clear();
  }

  private async sync(
    tableId: string,
    records: (string | { id: string; fields: Record<string, unknown> })[],
    actorUserId: string | undefined,
    removed = false
  ) {
    if (!this.config.ragDatabaseUrl || !records.length) return;
    try {
      const target = await this.targetFor(tableId);
      if (!target) return;
      const ids = records
        .filter(
          (r) =>
            typeof r === 'string' ||
            !target.watch ||
            Object.keys(r.fields).some((f) => target.watch!.has(f))
        )
        .map((r) => (typeof r === 'string' ? r : r.id));
      await this.ingest.enqueueRecords(
        target.collectionId,
        ids.map((recordId) => ({ baseId: target.baseId, tableId, recordId })),
        actorUserId ?? AGENT_ROBOT_ID,
        removed
      );
    } catch (error) {
      this.logger.warn(`knowledge sync for ${tableId} skipped: ${(error as Error).message}`);
    }
  }

  private async loadSettings(): Promise<ISyncSettings | null> {
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
      agentBaseId: row.baseId,
      memoryTableId: tableMap[AGENT_TABLES.memory] ?? null,
      memoryWatch: new Set(
        ['title', 'content', 'is_active'].map((k) => memoryFields[k]).filter(Boolean)
      ),
      knowledgeTables: new Set(profile?.knowledgeTables ?? []),
    };
  }

  private async currentSettings() {
    if (!this.settings || Date.now() - this.settings.at > cacheMs) {
      this.settings = { at: Date.now(), value: await this.loadSettings() };
    }
    return this.settings.value;
  }

  private async targetFor(tableId: string): Promise<ISyncTarget | null> {
    const settings = await this.currentSettings();
    if (!settings) return null;
    const hit = this.targets.get(tableId);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
    const value = await this.resolve(tableId, settings);
    this.targets.set(tableId, { at: Date.now(), value });
    return value;
  }

  private async resolve(tableId: string, settings: ISyncSettings): Promise<ISyncTarget | null> {
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
