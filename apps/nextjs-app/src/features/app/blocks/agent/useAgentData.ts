import { useQuery } from '@tanstack/react-query';
import { getAgentStatus, getAgentThreadMessages, getRecords } from '@teable/openapi';
import type { UIMessage } from 'ai';
import type { IAgentSkillOption } from './components/AgentComposer';

export const agentQueryKeys = {
  status: ['agent', 'status'] as const,
  threads: ['agent', 'threads'] as const,
  messages: (threadId: string) => ['agent', 'messages', threadId] as const,
  skills: ['agent', 'skills'] as const,
};

export const useAgentStatus = (enabled = true) =>
  useQuery({
    queryKey: agentQueryKeys.status,
    queryFn: getAgentStatus,
    enabled,
    staleTime: 60_000,
  });

/**
 * Stored messages of a thread, as UI messages for the chat. Fetched again every time a chat
 * mounts: a thread opened earlier has new messages and answered approvals since.
 */
export const useThreadMessages = (threadId?: string) =>
  useQuery({
    queryKey: agentQueryKeys.messages(threadId ?? ''),
    queryFn: async () =>
      (await getAgentThreadMessages(threadId!)).messages.map(
        (m) => ({ id: m.id, role: m.role, parts: m.parts }) as unknown as UIMessage
      ),
    enabled: Boolean(threadId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

/** Active skills for the `/` picker, read from the agent_skills table in the Agent base. */
export const useAgentSkills = (skillsTableId?: string) =>
  useQuery({
    queryKey: [...agentQueryKeys.skills, skillsTableId],
    enabled: Boolean(skillsTableId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<IAgentSkillOption[]> => {
      const { data } = await getRecords(skillsTableId!, { take: 200 });
      return data.records
        .filter((r) => r.fields.is_active === true)
        .map((r) => ({
          name: String(r.fields.name ?? ''),
          description: (r.fields.description as string | undefined) ?? null,
        }))
        .filter((s) => s.name);
    },
  });
