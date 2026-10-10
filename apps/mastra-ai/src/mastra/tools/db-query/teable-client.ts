/**
 * Shared-token REST client. NOT USED FOR READS: every read tool goes through
 * ai-data-client.ts as the chatting user. Only write paths still use this: the unused
 * write tools (kept for a future write gateway, CYBERDATA-12) and the RAG agent's
 * synthesize-and-ingest, which is gated on the user's write permission.
 */
import { env } from '../../env.js';

export const BASE_URL = env.TEABLE_BASE_URL;

export interface TeableRecord<T = Record<string, unknown>> {
  id: string;
  fields: T;
}

export interface ListParams {
  take?: number;
  skip?: number;
  /** Pre-serialized JSON filter string. fieldId keys must use actual field IDs. */
  filter?: string;
  /** Pre-serialized JSON orderBy string. fieldId keys must use actual field IDs. */
  orderBy?: string;
  search?: string;
}

export function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.CYBERNETICS_APP_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function listUrl(tableId: string, params: ListParams): string {
  const url = new URL(`${BASE_URL}/api/table/${tableId}/record`);
  url.searchParams.set('fieldKeyType', 'name');
  if (params.take !== undefined) url.searchParams.set('take', String(params.take));
  if (params.skip !== undefined) url.searchParams.set('skip', String(params.skip));
  if (params.filter) url.searchParams.set('filter', params.filter);
  if (params.orderBy) url.searchParams.set('orderBy', params.orderBy);
  if (params.search) url.searchParams.set('search', params.search);
  return url.toString();
}

export async function teableList<T>(
  tableId: string,
  params: ListParams = {}
): Promise<{ records: TeableRecord<T>[] }> {
  const res = await fetch(listUrl(tableId, params), { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET table/${tableId}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<{ records: TeableRecord<T>[] }>;
}

export async function teableCreate<T>(
  tableId: string,
  fields: Partial<T>[]
): Promise<{ records: TeableRecord<T>[] }> {
  const res = await fetch(`${BASE_URL}/api/table/${tableId}/record`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      fieldKeyType: 'name',
      // Coerces a title string into a link cell. Without this every write to a
      // link column fails once knowledge_type stops being plain text.
      typecast: true,
      records: fields.map((f) => ({ fields: f })),
    }),
  });
  if (!res.ok) throw new Error(`POST table/${tableId}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<{ records: TeableRecord<T>[] }>;
}

export async function teableUpdate<T>(
  tableId: string,
  recordId: string,
  fields: Partial<T>
): Promise<{ record: TeableRecord<T> }> {
  const res = await fetch(`${BASE_URL}/api/table/${tableId}/record/${recordId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ fieldKeyType: 'name', typecast: true, record: { fields } }),
  });
  if (!res.ok)
    throw new Error(`PATCH table/${tableId}/${recordId}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<{ record: TeableRecord<T> }>;
}

export async function teableDelete(tableId: string, recordId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/table/${tableId}/record/${recordId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error(`DELETE table/${tableId}/${recordId}: ${res.status} ${res.statusText}`);
}

export async function teableGetById<T>(
  tableId: string,
  recordId: string
): Promise<TeableRecord<T> | null> {
  const url = new URL(`${BASE_URL}/api/table/${tableId}/record/${recordId}`);
  url.searchParams.set('fieldKeyType', 'name');
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET table/${tableId}/${recordId}: ${res.status} ${res.statusText}`);
  // Teable may return { record: {...} } or the record object directly
  const data = (await res.json()) as Record<string, unknown>;
  return ('record' in data ? data['record'] : data) as TeableRecord<T>;
}

export async function teableGetByIds<T>(
  tableId: string,
  recordIds: string[]
): Promise<TeableRecord<T>[]> {
  if (recordIds.length === 0) return [];
  const results = await Promise.all(recordIds.map((id) => teableGetById<T>(tableId, id)));
  return results.filter((r): r is TeableRecord<T> => r !== null);
}

/**
 * Normalises a link field value to an array of record ID strings.
 * Teable may return either string IDs or { id, title } objects depending on context.
 */
export function toLinkIds(value?: Array<string | { id: string }>): string[] {
  if (!value) return [];
  return value.map((v) => (typeof v === 'string' ? v : v.id));
}
