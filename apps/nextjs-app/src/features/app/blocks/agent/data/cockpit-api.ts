import {
  COCKPIT_SEARCH_TAKE,
  getAgentTableOverviewNodes,
  getCockpitRecord,
  searchCockpitTable,
  summarizeCockpitRecord,
} from '@teable/openapi';

/** Scope design §7, §8: the cockpit's search, its reader and the forced records' nodes. */
export const cockpitQueryKeys = {
  search: (tableId: string, text: string, nonce: number) =>
    ['agent', 'cockpit', 'search', tableId, text, nonce] as const,
  record: (tableId: string, recordId: string) =>
    ['agent', 'cockpit', 'record', tableId, recordId] as const,
  summary: (recordId: string, version: string) =>
    ['agent', 'cockpit', 'summary', recordId, version] as const,
  nodes: (tableId: string, recordIds: string[]) =>
    ['agent', 'overview', 'nodes', tableId, ...recordIds] as const,
};

/** The table page's Search on one table (every field, matching rows only). */
export const searchTable = (tableId: string, q: string, signal?: AbortSignal) =>
  searchCockpitTable(tableId, { q, take: COCKPIT_SEARCH_TAKE }, signal);

export const fetchRecord = (tableId: string, recordId: string) =>
  getCockpitRecord(tableId, recordId);

export const fetchSummary = (tableId: string, recordId: string, signal?: AbortSignal) =>
  summarizeCockpitRecord(tableId, recordId, signal);

/** Forced records the overview did not read, encoded as it draws them. */
export const fetchNodes = (tableId: string, recordIds: string[]) =>
  getAgentTableOverviewNodes(tableId, { recordIds });
