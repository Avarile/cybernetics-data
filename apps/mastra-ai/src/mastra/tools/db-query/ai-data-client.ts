import { env } from '../../env.js';

/**
 * Client for the Teable backend's internal ai-data endpoint. Every call reads as the
 * user who is chatting, in the base the chat runs in: the backend issued the context
 * token for this chat turn and passed it in the agent's requestContext. Mastra holds
 * no data credential of its own.
 */

export interface AiDataRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface AiDataRecordsPage {
  records: AiDataRecord[];
  returned: number;
  hasMore: boolean;
  nextSkip: number | null;
  truncated: boolean;
  softDeletedExcluded: boolean;
}

export interface AiDataTableSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface AiDataField {
  id: string;
  name: string;
  type: string;
  isPrimary: boolean;
  isComputed: boolean;
  linkedTableId?: string;
  choices?: string[];
}

export interface AiDataTable extends AiDataTableSummary {
  baseId: string;
  profile: { titleFieldId?: string; contextFieldId?: string; softDeleteFieldId?: string };
  fields: AiDataField[];
}

export interface AiDataFilterItem {
  /** Field id or field name. */
  fieldId: string;
  operator: string;
  value?: unknown;
}

export interface AiDataFilter {
  conjunction: 'and' | 'or';
  filterSet: Array<AiDataFilterItem | AiDataFilter>;
}

export interface AiDataQuery {
  search?: string;
  filter?: AiDataFilter;
  orderBy?: { fieldId: string; order: 'asc' | 'desc' }[];
  projection?: string[];
  take?: number;
  skip?: number;
  includeDeleted?: boolean;
}

/** The backend's per-call cap on returned records and on ids per getRecords call. */
export const MAX_RECORDS_PER_CALL = 50;

/** What a tool's execute() receives as its second argument, as far as this client cares. */
export interface ToolContextLike {
  requestContext?: { get(key: string): unknown };
}

export class AiDataClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = env.PUBLIC_ORIGIN,
    private readonly serviceKey: string | undefined = env.MASTRA_API_KEY
  ) {}

  listTables(): Promise<AiDataTableSummary[]> {
    return this.call('list-tables', {});
  }

  describeTable(table: string): Promise<AiDataTable> {
    return this.call('describe-table', { tableId: table });
  }

  /** Read one page. Cells are keyed by field name. */
  queryRecords(table: string, query: AiDataQuery = {}): Promise<AiDataRecordsPage> {
    return this.call('query-records', {
      ...query,
      take: Math.min(query.take ?? 20, MAX_RECORDS_PER_CALL),
      tableId: table,
      fieldKeyType: 'name',
    });
  }

  /** Fetch records by id, any number, in batches. Cells are keyed by field name. Order follows ids. */
  async getRecordsByIds(table: string, recordIds: string[]): Promise<AiDataRecord[]> {
    const ids = [...new Set(recordIds.filter(Boolean))];
    const found = new Map<string, AiDataRecord>();
    for (let i = 0; i < ids.length; i += MAX_RECORDS_PER_CALL) {
      const batch = ids.slice(i, i + MAX_RECORDS_PER_CALL);
      const result = await this.call<{ records: AiDataRecord[] }>('get-records', {
        tableId: table,
        recordIds: batch,
        fieldKeyType: 'name',
      });
      for (const record of result.records) found.set(record.id, record);
    }
    return ids.map((id) => found.get(id)).filter((r): r is AiDataRecord => r !== undefined);
  }

  private async call<T>(op: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/internal/ai-data/${op}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.serviceKey ?? ''}`,
        'x-ai-data-context': this.token,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;

    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: unknown };
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      /* not JSON */
    }
    // Messages are written for users by the backend (permission, not found, bad field).
    throw new Error(`Data lookup failed (${res.status}): ${message}`);
  }
}

/** Build a client from a tool's execution context, or explain why data is unavailable. */
export function aiDataClient(context: ToolContextLike | undefined): AiDataClient {
  const token = context?.requestContext?.get('aiDataContext');
  if (typeof token !== 'string' || !token) {
    throw new Error(
      'No user context for this request, so Teable data cannot be read. ' +
        'Data tools only work in a chat started from Teable.'
    );
  }
  return new AiDataClient(token);
}

/** True when the backend says the chatting user may write records in this base. */
export function canWrite(context: ToolContextLike | undefined): boolean {
  return context?.requestContext?.get('canWrite') === true;
}
