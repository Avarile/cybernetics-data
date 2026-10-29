/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IClarifyPart,
  ISearchHitPart,
  ISearchLensPart,
  ISearchPlanPart,
  ISearchStepPart,
} from '@teable/openapi';
import type { IFieldRecord, ISchemaField, ITableSchema } from '../search/schema';

/** The tables of a base with their links, as the planner needs them (cockpit design §9.2). */
export interface ISearchSchema {
  baseId: string;
  baseName: string;
  tables: ITableSchema[];
  /** Table ids never searched: search_exclude (by table or by base). */
  excluded: Set<string>;
}

export interface ISchemaCatalogPort {
  /** The base the recipes use: `pinned` when it exists, else the one with most recipe tables. */
  dataBase(pinned?: string | null): Promise<{ id: string; name: string } | undefined>;
  schema(baseId: string): Promise<ISearchSchema>;
}

export const SCHEMA_CATALOG_PORT = Symbol('AGENT_SCHEMA_CATALOG_PORT');

/** A full-text hit in one table. */
export interface IRankedId {
  recordId: string;
  rank: number;
}

export interface IReadOptions {
  take: number;
  /** Soft-deleted records too (deleted_at set). */
  includeDeleted?: boolean;
}

/**
 * Reads for the search executor, as the agent principal, records keyed by field name. Every
 * call is capped by the data layer (at most 50 records a call).
 */
export interface ISearchReaderPort {
  /** Records whose primary field contains `text`. */
  titleMatches(
    table: ITableSchema,
    text: string,
    options: IReadOptions & { filter?: unknown }
  ): Promise<IFieldRecord[]>;
  /** The full-text index's hits in one table, best first. */
  fullText(table: ITableSchema, text: string, take: number): Promise<IRankedId[]>;
  /** Teable's own record search (when the index has nothing yet). */
  quickSearch(
    table: ITableSchema,
    text: string,
    options: IReadOptions & { filter?: unknown }
  ): Promise<IFieldRecord[]>;
  /** Records by id, in the order asked. */
  byIds(table: ITableSchema, ids: string[]): Promise<IFieldRecord[]>;
  /** Records matching a Teable filter (fields by name), with the full count. */
  filter(
    table: ITableSchema,
    filter: unknown,
    options: IReadOptions & { orderBy?: { field: string; order: 'asc' | 'desc' }[] }
  ): Promise<{ records: IFieldRecord[]; total: number }>;
  /** Records of `table` whose link field points at any of `ids`. */
  linkedTo(
    table: ITableSchema,
    field: ISchemaField,
    ids: string[],
    options: IReadOptions
  ): Promise<IFieldRecord[]>;
  /** Sums of number fields over a filter. */
  totals(table: ITableSchema, fields: string[], filter: unknown): Promise<Record<string, number>>;
}

export const SEARCH_READER_PORT = Symbol('AGENT_SEARCH_READER_PORT');

/** Where a search's progress goes: the turn's UI stream (cockpit design §7.1). */
export interface ISearchEventSink {
  plan(part: ISearchPlanPart): void;
  step(part: ISearchStepPart): void;
  hit(part: ISearchHitPart): void;
  lens(part: ISearchLensPart): void;
  clarify(part: IClarifyPart): void;
}
