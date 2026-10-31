import { useQuery } from '@tanstack/react-query';
import { getAgentStatus } from '@teable/openapi';
import { agentQueryKeys } from '../data/agent-api';

export const useAgentStatus = (enabled = true) =>
  useQuery({
    queryKey: agentQueryKeys.status,
    queryFn: getAgentStatus,
    enabled,
    staleTime: 60_000,
  });
