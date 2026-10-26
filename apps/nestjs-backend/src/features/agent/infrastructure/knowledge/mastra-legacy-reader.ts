/* eslint-disable @typescript-eslint/naming-convention */ // SQL column names
import { Injectable } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import { AgentConfig, type IAgentConfig } from '../../../../configs/agent.config';

export interface ILegacyIndex {
  name: string;
  label: string | null;
  description: string | null;
  /** Listed in index_schema.embedding_index. */
  registered: boolean;
  /** Has a vector table in vector_schema. */
  hasTable: boolean;
}

export interface ILegacyChunk {
  materialId: string;
  docName: string;
  chunkIndex: number;
  text: string;
}

/**
 * Reads what Mastra left in the vector database (design §14.3): the index registry and the
 * chunk text in each vector table's metadata. Read only; vectors are not read (they are
 * re-embedded). Connects only when the import runs.
 */
@Injectable()
export class MastraLegacyReader {
  constructor(@AgentConfig() private readonly config: IAgentConfig) {}

  /** Undefined when no vector database is configured. */
  async read<T>(fn: (db: Knex) => Promise<T>): Promise<T | undefined> {
    if (!this.config.legacyVectorDatabaseUrl) return undefined;
    const db = knex({
      client: 'pg',
      connection: this.config.legacyVectorDatabaseUrl,
      pool: { min: 0, max: 2 },
    });
    try {
      return await fn(db);
    } finally {
      await db.destroy();
    }
  }

  async indexes(db: Knex): Promise<ILegacyIndex[]> {
    const registry = await db.raw(`SELECT to_regclass('index_schema.embedding_index') AS t`);
    const rows: { name: string; label: string; description: string | null }[] = registry.rows[0].t
      ? await db('index_schema.embedding_index')
          .select('name', 'label', 'description')
          .orderBy('id')
      : [];
    const tables: string[] = (
      await db('information_schema.tables')
        .where({ table_schema: 'vector_schema' })
        .select('table_name')
        .orderBy('table_name')
    ).map((t: { table_name: string }) => t.table_name);
    const byName = new Map<string, ILegacyIndex>();
    for (const r of rows) {
      byName.set(r.name, {
        name: r.name,
        label: r.label,
        description: r.description,
        registered: true,
        hasTable: tables.includes(r.name),
      });
    }
    for (const t of tables) {
      if (!byName.has(t)) {
        byName.set(t, {
          name: t,
          label: null,
          description: null,
          registered: false,
          hasTable: true,
        });
      }
    }
    return [...byName.values()];
  }

  /** The chunks of an index, ordered by document and position. */
  async chunks(db: Knex, index: string): Promise<ILegacyChunk[]> {
    const rows: { vector_id: string; id: number; metadata: Record<string, unknown> | null }[] =
      await db.withSchema('vector_schema').from(index).select('id', 'vector_id', 'metadata');
    return rows
      .map((r) => {
        const m = r.metadata ?? {};
        const materialId = String(m.materialId ?? r.vector_id.replace(/_\d+$/, ''));
        return {
          materialId,
          docName: String(m.docName ?? m.source ?? materialId),
          chunkIndex: Number(m.chunkIndex ?? r.id),
          // dd_worksheet kept its text in `item`; every other index in `content`
          text: String(m.content ?? m.item ?? ''),
        };
      })
      .sort((a, b) =>
        a.materialId === b.materialId
          ? a.chunkIndex - b.chunkIndex
          : a.materialId.localeCompare(b.materialId)
      );
  }
}
