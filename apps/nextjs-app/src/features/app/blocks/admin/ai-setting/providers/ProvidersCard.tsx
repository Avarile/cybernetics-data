import type { HttpError } from '@cybernetics/core';
import type { IAiProviderVo, IGatewayModel } from '@teable/openapi';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { DeleteProviderDialog } from './DeleteProviderDialog';
import { PROVIDER_PRESETS } from './presets';
import { ProviderIcon } from './ProviderIcon';
import { ProviderRow } from './ProviderRow';
import type { IProviderRowActions } from './ProviderRow';
import type { IProviderSheetMode } from './ProviderSheet';
import { ProviderSheet } from './ProviderSheet';
import { useAiProviders, useProviderMutations } from './useProviders';

interface IProvidersCardProps {
  gatewayModels: IGatewayModel[];
  onGatewayModelsChange: (models: IGatewayModel[]) => void;
}

/** Admin ▸ AI Settings ▸ Providers: every LLM provider, its key source and health. */
export const ProvidersCard = ({ gatewayModels, onGatewayModelsChange }: IProvidersCardProps) => {
  const { t } = useTranslation('common');
  const { data, isLoading } = useAiProviders();
  const { update, test, fetchModels } = useProviderMutations();
  const [sheet, setSheet] = useState<IProviderSheetMode | null>(null);
  const [deleting, setDeleting] = useState<IAiProviderVo | null>(null);

  const providers = data?.providers ?? [];
  const takenIds = providers.map((p) => p.id);
  const ready = providers.filter((p) => p.status === 'ready').length;
  const attention = providers.filter((p) => p.status === 'error' || p.status === 'not-set').length;
  const onError = (e: unknown) => toast.error((e as HttpError).message);

  const actions: IProviderRowActions = {
    onEdit: (provider) => setSheet({ kind: 'edit', provider }),
    onDuplicate: (provider) => setSheet({ kind: 'duplicate', provider }),
    onDelete: setDeleting,
    onTest: (provider) => {
      void test.mutateAsync({ providerId: provider.id }).then((res) => {
        if (res.ok) toast.success(t('admin.setting.ai.providers.testPassed', 'Connection works'));
        else toast.error([res.error, res.hint].filter(Boolean).join(' — '));
      }, onError);
    },
    onToggleEnabled: (provider) => {
      void update
        .mutateAsync({
          id: provider.id,
          ro: { version: provider.version, enabled: provider.enabled === false },
        })
        .catch(onError);
    },
    onRefreshModels: (provider) => void refreshModels(provider),
  };

  async function refreshModels(provider: IAiProviderVo) {
    try {
      const res = await fetchModels.mutateAsync(provider.id);
      if (!res.fetched) {
        toast.error(
          res.error ??
            t('admin.setting.ai.providers.noListing', 'This provider has no model listing')
        );
        return;
      }
      // Newly listed models are added; models the admin chose stay.
      const current = (provider.models ?? '').split(',').filter(Boolean);
      const models = [...new Set([...current, ...res.models])].join(',');
      if (models !== provider.models) {
        await update.mutateAsync({ id: provider.id, ro: { version: provider.version, models } });
      }
      toast.success(t('admin.setting.ai.providers.modelsRefreshed', 'Models refreshed'));
    } catch (e) {
      onError(e);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">
            {t('admin.setting.ai.providers.title', 'Providers')}
          </CardTitle>
          {providers.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'admin.setting.ai.providers.summary',
                '{{total}} providers · {{ready}} ready · {{attention}} need attention',
                { total: providers.length, ready, attention }
              )}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setSheet({ kind: 'add' })} data-testid="provider-add">
          <Plus className="size-4" />
          {t('admin.setting.ai.providers.add', 'Add provider')}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {!isLoading && providers.length === 0 && (
          <div className="space-y-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('admin.setting.ai.providers.empty', 'No providers yet. Start with one of these:')}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {PROVIDER_PRESETS.filter((p) => p.quick).map((preset) => (
                <Button
                  key={preset.key}
                  variant="outline"
                  size="sm"
                  onClick={() => setSheet({ kind: 'add', preset })}
                >
                  <ProviderIcon type={preset.type} className="size-4" />
                  {preset.label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setSheet({ kind: 'add' })}>
                {t('admin.setting.ai.providers.allProviders', 'All providers…')}
              </Button>
            </div>
          </div>
        )}
        {providers.length > 0 && (
          <div className="divide-y border-t">
            {providers.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} actions={actions} />
            ))}
          </div>
        )}
      </CardContent>

      <ProviderSheet
        mode={sheet}
        onClose={() => setSheet(null)}
        takenIds={takenIds}
        gatewayModels={gatewayModels}
        onGatewayModelsChange={onGatewayModelsChange}
      />
      <DeleteProviderDialog provider={deleting} onClose={() => setDeleting(null)} />
    </Card>
  );
};
