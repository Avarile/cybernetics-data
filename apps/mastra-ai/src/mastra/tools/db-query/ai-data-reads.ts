import type { AiDataClient, AiDataFilter, AiDataRecord } from './ai-data-client.js';
import { linkIds } from './knowledges/link-cell.js';

/**
 * Read helpers for the knowledge, project and contact tables, addressed by table and
 * field NAME. Ids are resolved by the backend per base, so nothing here depends on a
 * particular deployment. All reads go through AiDataClient, as the chatting user.
 */
export const TABLES = {
  knowledges: 'knowledges',
  knowledgeTypes: 'knowledge_type',
  goals: 'goals',
  projects: 'projects',
  tasks: 'tasks',
  frameworks: 'project_frameworks',
  contacts: 'contacts',
  contactTypes: 'contact_type',
  contactProfessions: 'contact_profession',
  companies: 'companies',
  tableReferences: 'table_references',
} as const;

export interface ListOptions {
  take?: number;
  skip?: number;
  search?: string;
}

const where = (
  conjunction: 'and' | 'or',
  items: { field: string; operator: string; value?: unknown }[]
): AiDataFilter => ({
  conjunction,
  filterSet: items.map(({ field, operator, value }) => ({
    fieldId: field,
    operator,
    value: value ?? null,
  })),
});

export async function listRecords(
  client: AiDataClient,
  table: string,
  options: ListOptions & { filter?: AiDataFilter } = {}
): Promise<AiDataRecord[]> {
  const page = await client.queryRecords(table, {
    take: options.take ?? 50,
    skip: options.skip,
    search: options.search,
    filter: options.filter,
  });
  return page.records;
}

/** Records whose title contains the keyword. */
export function searchByTitle(
  client: AiDataClient,
  table: string,
  keyword: string,
  options: ListOptions = {}
): Promise<AiDataRecord[]> {
  return listRecords(client, table, {
    ...options,
    filter: where('and', [{ field: 'title', operator: 'contains', value: keyword }]),
  });
}

/** The first record whose title is exactly `title`, if any. */
export async function findByTitle(
  client: AiDataClient,
  table: string,
  title: string
): Promise<AiDataRecord | undefined> {
  const records = await listRecords(client, table, {
    take: 1,
    filter: where('and', [{ field: 'title', operator: 'is', value: title }]),
  });
  return records[0];
}

export async function getById(
  client: AiDataClient,
  table: string,
  recordId: string
): Promise<AiDataRecord | undefined> {
  const [record] = await client.getRecordsByIds(table, [recordId]);
  return record;
}

/** Resolve the records a link cell points to. */
export function followLink(
  client: AiDataClient,
  table: string,
  cell: unknown
): Promise<AiDataRecord[]> {
  const ids = linkIds(cell);
  return ids.length ? client.getRecordsByIds(table, ids) : Promise.resolve([]);
}

/** Contacts by name or email keyword. */
export function searchContacts(
  client: AiDataClient,
  keyword: string,
  options: ListOptions = {}
): Promise<AiDataRecord[]> {
  return listRecords(client, TABLES.contacts, {
    ...options,
    filter: where('or', [
      { field: 'firstname', operator: 'contains', value: keyword },
      { field: 'lastname', operator: 'contains', value: keyword },
      { field: 'email', operator: 'contains', value: keyword },
    ]),
  });
}

export function listFrameworksByType(
  client: AiDataClient,
  type: string,
  options: ListOptions = {}
): Promise<AiDataRecord[]> {
  return listRecords(client, TABLES.frameworks, {
    ...options,
    filter: where('and', [{ field: 'type', operator: 'is', value: type }]),
  });
}

/**
 * Records of `table` reached through the `linkField` of the record titled `title` in
 * `ownerTable` (e.g. the contacts of a contact type, through its reverse link).
 */
export async function linkedByOwnerTitle(
  client: AiDataClient,
  ownerTable: string,
  title: string,
  linkField: string,
  table: string,
  options: ListOptions = {}
): Promise<AiDataRecord[]> {
  const owner = await findByTitle(client, ownerTable, title);
  if (!owner) return [];
  const ids = linkIds(owner.fields[linkField]);
  const skip = options.skip ?? 0;
  const page = ids.slice(skip, options.take ? skip + options.take : undefined);
  return page.length ? client.getRecordsByIds(table, page) : [];
}
