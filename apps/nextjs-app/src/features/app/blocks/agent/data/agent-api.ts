import {
  cancelAgentRun,
  getAgentSearch,
  getAgentTableOverview,
  getAgentThreadMessages,
  getCockpitBases,
  getCockpitTables,
  getRecords,
  setCockpitDefaultBase,
} from '@teable/openapi';
import type { UIMessage } from 'ai';
import type { IAgentSkillOption } from '../model/skills';

export const agentQueryKeys = {
  status: ['agent', 'status'] as const,
  threads: ['agent', 'threads'] as const,
  skills: ['agent', 'skills'] as const,
  search: (searchId: string) => ['agent', 'search', searchId] as const,
  bases: ['agent', 'cockpit', 'bases'] as const,
  tables: (baseId: string) => ['agent', 'cockpit', 'tables', baseId] as const,
  tableOverview: (tableId: string) => ['agent', 'overview', 'table', tableId] as const,
};

/** Stored messages of a thread, as UI messages for the chat. */
export const fetchThreadMessages = async (threadId: string): Promise<UIMessage[]> =>
  (await getAgentThreadMessages(threadId)).messages.map(
    (m) => ({ id: m.id, role: m.role, parts: m.parts }) as unknown as UIMessage
  );

/** Active skills for the `/` picker, read from the agent_skills table in the Agent base. */
export const fetchSkills = async (skillsTableId: string): Promise<IAgentSkillOption[]> => {
  const { data } = await getRecords(skillsTableId, { take: 200 });
  return data.records
    .filter((r) => r.fields.is_active === true)
    .map((r) => ({
      name: String(r.fields.name ?? ''),
      description: (r.fields.description as string | undefined) ?? null,
    }))
    .filter((s) => s.name);
};

/** A stored search, for the board of a reopened thread. */
export const fetchSearch = (searchId: string) => getAgentSearch(searchId);

/** The bases the cockpit can show, and the default one (scope design §5). */
export const fetchBases = () => getCockpitBases();
export const fetchTables = (baseId: string) => getCockpitTables(baseId);
export const saveDefaultBase = (baseId: string) => setCockpitDefaultBase({ baseId });

/** One table of a base as a constellation (scope design §9). */
export const fetchTableOverview = (tableId: string) => getAgentTableOverview(tableId);

/** Stops a run on the server (also one that waits for approval). */
export const cancelRun = (runId: string) => cancelAgentRun(runId).catch(() => undefined);
