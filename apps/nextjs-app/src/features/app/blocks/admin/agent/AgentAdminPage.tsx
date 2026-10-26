import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IAgentStatusVo, IUpdateAgentSetupRo } from '@teable/openapi';
import { getAgentSetup, getAgentStatus, getSetting, updateAgentSetup } from '@teable/openapi';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { AgentCredentialsCard } from './AgentCredentialsCard';
import { AgentAuditCard } from './AgentRecordsCards';
import { AgentBehaviourCard, AgentModelsCard } from './AgentSetupCards';
import { AgentStatusCard } from './AgentStatusCard';

/** Admin ▸ Agent (design §13). */
export const AgentAdminPage = () => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['agent', 'status'], queryFn: getAgentStatus });
  const ready = Boolean(status?.enabled && status.status === 'ok');
  const { data: setup } = useQuery({
    queryKey: ['agent', 'setup'],
    queryFn: getAgentSetup,
    enabled: ready,
  });
  const { data: setting } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
  });
  const save = useMutation({
    mutationFn: (patch: IUpdateAgentSetupRo) => updateAgentSetup(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(['agent', 'setup'], next);
      void queryClient.invalidateQueries({ queryKey: ['agent', 'status'] });
      toast.success(t('agent.admin.saved', 'Saved'));
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const onStatus = (next: IAgentStatusVo) => {
    queryClient.setQueryData(['agent', 'status'], next);
    void queryClient.invalidateQueries({ queryKey: ['agent'] });
  };

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto overflow-x-hidden p-4 sm:p-8">
      <div className="pb-6">
        <h1 className="text-2xl font-semibold">{t('agent.admin.title', 'Agent')}</h1>
        <div className="mt-2 text-sm text-muted-foreground">
          {t(
            'agent.admin.description',
            'An assistant for instance admins that can work with all data. Its conversations, memory and skills live in the Agent base.'
          )}
        </div>
      </div>
      <div className="flex max-w-3xl flex-col gap-6">
        <AgentStatusCard status={status} onChanged={onStatus} />
        {ready && setup && (
          <>
            <AgentModelsCard
              setup={setup}
              gatewayModels={setting?.aiConfig?.gatewayModels ?? []}
              onSave={(patch) => save.mutate(patch)}
            />
            <AgentBehaviourCard
              key={setup.id}
              setup={setup}
              onSave={(patch) => save.mutate(patch)}
            />
            <AgentCredentialsCard />
          </>
        )}
        {status?.enabled && <AgentAuditCard />}
      </div>
    </div>
  );
};
