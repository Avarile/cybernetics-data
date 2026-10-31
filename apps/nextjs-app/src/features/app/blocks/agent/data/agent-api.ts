import {
  getAgentTableOverview,
  getCockpitBases,
  getCockpitTables,
  setCockpitDefaultBase,
} from '@teable/openapi';

export const agentQueryKeys = {
  status: ['agent', 'status'] as const,
  bases: ['agent', 'cockpit', 'bases'] as const,
  tables: (baseId: string) => ['agent', 'cockpit', 'tables', baseId] as const,
  tableOverview: (tableId: string) => ['agent', 'overview', 'table', tableId] as const,
};

/** The bases the cockpit can show, and the default one (scope design §5). */
export const fetchBases = () => getCockpitBases();
export const fetchTables = (baseId: string) => getCockpitTables(baseId);
export const saveDefaultBase = (baseId: string) => setCockpitDefaultBase({ baseId });

/** One table of a base as a constellation (scope design §9). */
export const fetchTableOverview = (tableId: string) => getAgentTableOverview(tableId);
