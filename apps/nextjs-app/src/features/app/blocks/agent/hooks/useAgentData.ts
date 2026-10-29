import { useQuery } from '@tanstack/react-query';
import { getAgentStatus, listAgentThreads } from '@teable/openapi';
import { agentQueryKeys, fetchSkills } from '../data/agent-api';

export const useAgentStatus = (enabled = true) =>
  useQuery({
    queryKey: agentQueryKeys.status,
    queryFn: getAgentStatus,
    enabled,
    staleTime: 60_000,
  });

/** Active skills for the `/` picker. */
export const useAgentSkills = (skillsTableId?: string) =>
  useQuery({
    queryKey: [...agentQueryKeys.skills, skillsTableId],
    enabled: Boolean(skillsTableId),
    staleTime: 5 * 60_000,
    queryFn: () => fetchSkills(skillsTableId!),
  });

/** The admin's threads, active or archived. */
export const useThreads = (status: 'active' | 'archived', enabled = true) =>
  useQuery({
    queryKey: [...agentQueryKeys.threads, status],
    queryFn: () => listAgentThreads({ status }),
    enabled,
  });
