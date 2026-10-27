import { AGENT_ROBOT_ID } from '@cybernetics/core';
import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
  TableDeleteEvent,
} from '../../../../event-emitter/events';
import { KnowledgeSync } from '../../application/knowledge/knowledge-sync';
import { SearchTables } from './search-tables';

const asArray = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);
/** Field changes come in bursts (a conversion, an import): one table sync after they settle. */
export const SCHEMA_SETTLE_MS = 2000;

/**
 * Keeps search in step with the data (design §11.3, current-design §4.6). Record changes in
 * searched tables queue their records (ids only; the job reads them); deletes remove their
 * documents; a table whose fields change is synced again (field names are part of the text); a
 * deleted table's documents go; a change to agent_setup (search scope, exclusions, knowledge
 * tables) queues a full sync. Never fails the write that raised the event.
 */
@Injectable()
export class KnowledgeSyncListener implements OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeSyncListener.name);
  private readonly settling = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly sync: KnowledgeSync,
    private readonly tables: SearchTables
  ) {}

  onModuleDestroy() {
    for (const timer of this.settling.values()) clearTimeout(timer);
  }

  @OnEvent(Events.TABLE_RECORD_CREATE, { async: true })
  async onCreate(event: RecordCreateEvent) {
    const { tableId, record } = event.payload;
    await this.records(
      tableId,
      asArray(record).map((r) => ({ id: r.id, fields: null })),
      event.context.user?.id
    );
  }

  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  async onUpdate(event: RecordUpdateEvent) {
    const { tableId, record } = event.payload;
    await this.records(tableId, asArray(record), event.context.user?.id);
  }

  @OnEvent(Events.TABLE_RECORD_DELETE, { async: true })
  async onDelete(event: RecordDeleteEvent) {
    const { tableId, recordId } = event.payload;
    await this.safely(tableId, async () => {
      const target = await this.tables.targetFor(tableId);
      if (target) {
        await this.sync.enqueueRemovals(target, tableId, asArray(recordId), this.actor(event));
      }
    });
  }

  @OnEvent(Events.TABLE_FIELD_CREATE, { async: true })
  async onFieldCreate(event: FieldCreateEvent) {
    this.fieldsChanged(event.payload.tableId, this.actor(event));
  }

  @OnEvent(Events.TABLE_FIELD_UPDATE, { async: true })
  async onFieldUpdate(event: FieldUpdateEvent) {
    this.fieldsChanged(event.payload.tableId, this.actor(event));
  }

  @OnEvent(Events.TABLE_FIELD_DELETE, { async: true })
  async onFieldDelete(event: FieldDeleteEvent) {
    this.fieldsChanged(event.payload.tableId, this.actor(event));
  }

  @OnEvent(Events.TABLE_DELETE, { async: true })
  async onTableDelete(event: TableDeleteEvent) {
    const { tableId } = event.payload;
    this.tables.invalidate();
    await this.safely(tableId, () =>
      this.sync.enqueueTable('remove-table', tableId, this.actor(event))
    );
  }

  /** Forget cached settings and table profiles (setup or schema changed). */
  invalidate() {
    this.tables.invalidate();
  }

  /** Field names are part of the text, and the table may now be a knowledge table or not. */
  private fieldsChanged(tableId: string, actorUserId: string) {
    this.tables.invalidate();
    this.settle(`table:${tableId}`, () =>
      this.sync.enqueueTable('sync-table', tableId, actorUserId)
    );
  }

  private actor(event: { context: { user?: { id?: string } } }) {
    return event.context.user?.id ?? AGENT_ROBOT_ID;
  }

  private async records(
    tableId: string,
    records: { id: string; fields: Record<string, unknown> | null }[],
    actorUserId: string | undefined
  ) {
    if (!records.length) return;
    await this.safely(tableId, async () => {
      const settings = await this.tables.currentSettings();
      if (!settings) return;
      if (tableId === settings.setupTableId) {
        // the search settings may have changed: everything is checked again
        this.tables.invalidate();
        this.settle('full', () => this.sync.enqueueFullSync(actorUserId ?? AGENT_ROBOT_ID));
        return;
      }
      const target = await this.tables.targetFor(tableId);
      if (!target) return;
      const ids = records
        .filter(
          (r) =>
            !r.fields || !target.watch || Object.keys(r.fields).some((f) => target.watch!.has(f))
        )
        .map((r) => r.id);
      if (ids.length) {
        await this.sync.enqueueRecords(target, tableId, ids, actorUserId ?? AGENT_ROBOT_ID);
      }
    });
  }

  /** Runs `job` once no more calls with the same key came for SCHEMA_SETTLE_MS. */
  private settle(key: string, job: () => Promise<unknown>) {
    clearTimeout(this.settling.get(key));
    const timer = setTimeout(() => {
      this.settling.delete(key);
      job().catch((error) =>
        this.logger.warn(`search sync for ${key} not queued: ${(error as Error).message}`)
      );
    }, SCHEMA_SETTLE_MS);
    timer.unref();
    this.settling.set(key, timer);
  }

  private async safely(tableId: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      this.logger.warn(`search sync for ${tableId} skipped: ${(error as Error).message}`);
    }
  }
}
