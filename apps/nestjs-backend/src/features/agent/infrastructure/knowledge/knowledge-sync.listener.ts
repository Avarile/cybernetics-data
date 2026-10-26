import { AGENT_ROBOT_ID } from '@cybernetics/core';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
} from '../../../../event-emitter/events';
import { KnowledgeIngest } from '../../application/knowledge/knowledge-ingest';
import { KnowledgeTables } from './knowledge-tables';

const asArray = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);

/**
 * Derived sync (design §11.3): record changes in knowledge tables and in agent_memory queue the
 * ingest job of that record; deletes remove its document. Only ids are queued here; the job reads
 * the record. Never fails the write that raised the event.
 */
@Injectable()
export class KnowledgeSyncListener {
  private readonly logger = new Logger(KnowledgeSyncListener.name);

  constructor(
    private readonly ingest: KnowledgeIngest,
    private readonly tables: KnowledgeTables
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
    this.tables.invalidate();
  }

  private async sync(
    tableId: string,
    records: (string | { id: string; fields: Record<string, unknown> })[],
    actorUserId: string | undefined,
    removed = false
  ) {
    if (!records.length) return;
    try {
      const target = await this.tables.targetFor(tableId);
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
}
