import { useIsHydrated } from '@cybernetics/sdk/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IGatewayModel, ISettingVo, IUpdateSettingRo } from '@teable/openapi';
import { getSetting, updateSetting } from '@teable/openapi';
import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AIConfigurationStatus } from '../setting/components/ai-config/AIConfigurationStatus';
import { AIControlCard } from '../setting/components/ai-config/AIControlCard';
import { DefaultModelsStep } from '../setting/components/ai-config/DefaultModelsStep';
import {
  generateGatewayModelKeyList,
  generateModelKeyList,
} from '../setting/components/ai-config/utils';
import { AppBuilderConfig } from './AppBuilderConfig';
import { ProvidersCard } from './providers/ProvidersCard';

export interface IAiSettingPageProps {
  settingServerData?: ISettingVo;
}

export const AiSettingPage = ({ settingServerData }: IAiSettingPageProps) => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const router = useRouter();
  const providersRef = useRef<HTMLDivElement>(null);
  const modelsRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const isHydrated = useIsHydrated();

  const { data: setting = settingServerData } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
  });

  const { mutateAsync: mutateUpdateSetting } = useMutation({
    mutationFn: (props: IUpdateSettingRo) => updateSetting(props),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting'] });
      queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
    },
  });

  useEffect(() => {
    const { anchor } = router.query;
    const target = anchor === 'llm' ? providersRef : anchor === 'app' ? appRef : undefined;
    if (target) setTimeout(() => target.current?.scrollIntoView({ behavior: 'smooth' }), 500);
  }, [router.query]);

  const handleNavigate = useCallback((section: string) => {
    const target = section === 'chat-model' ? modelsRef : providersRef;
    setTimeout(() => target.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  const aiConfig = setting?.aiConfig;
  // Models the default pickers offer: every enabled provider's models plus the Gateway pool.
  const models = useMemo(
    () => [
      ...generateModelKeyList((aiConfig?.llmProviders ?? []).filter((p) => p.enabled !== false)),
      ...generateGatewayModelKeyList(aiConfig?.gatewayModels),
    ],
    [aiConfig?.llmProviders, aiConfig?.gatewayModels]
  );

  if (!setting || !isHydrated) return null;

  // Providers and keys are saved through the provider routes; this PATCH carries the rest.
  const patchAiConfig = (patch: Partial<NonNullable<ISettingVo['aiConfig']>>) =>
    mutateUpdateSetting({
      aiConfig: { ...setting.aiConfig, ...patch },
    } as IUpdateSettingRo);

  const onControlChange = ({ disableActions }: { disableActions: string[] }) =>
    patchAiConfig({ capabilities: { ...setting.aiConfig?.capabilities, disableActions } });

  const saveAppConfig = (appConfig: NonNullable<ISettingVo['appConfig']>) => {
    mutateUpdateSetting({ appConfig } as IUpdateSettingRo);
  };

  return (
    <div className="flex h-screen flex-1 flex-col overflow-y-auto overflow-x-hidden p-4 sm:p-8">
      <div className="pb-6">
        <h1 className="text-2xl font-semibold">{t('admin.setting.ai.title', 'AI Settings')}</h1>
        <div className="mt-2 text-sm text-muted-foreground">
          {t(
            'admin.setting.ai.description',
            'Configure AI providers and models for your instance.'
          )}
        </div>
      </div>

      <div className="flex max-w-3xl flex-col gap-6">
        <AIConfigurationStatus aiConfig={setting.aiConfig} onNavigate={handleNavigate} />

        <div ref={providersRef}>
          <ProvidersCard
            gatewayModels={aiConfig?.gatewayModels ?? []}
            onGatewayModelsChange={(gatewayModels: IGatewayModel[]) =>
              patchAiConfig({ gatewayModels })
            }
          />
        </div>

        <div ref={modelsRef}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('admin.setting.ai.providers.defaultModels', 'Default models')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t(
                  'admin.setting.ai.providers.defaultModelsHelp',
                  'Used by field AI and other AI features unless they choose their own model.'
                )}
              </p>
            </CardHeader>
            <CardContent>
              <DefaultModelsStep
                chatModel={aiConfig?.chatModel ?? undefined}
                models={models}
                onChange={(chatModel) => patchAiConfig({ chatModel })}
                disabled={models.length === 0}
              />
            </CardContent>
          </Card>
        </div>

        <AIControlCard
          disableActions={setting.aiConfig?.capabilities?.disableActions ?? []}
          onChange={onControlChange}
        />

        <div ref={appRef}>
          <AppBuilderConfig appConfig={setting.appConfig} onSave={saveAppConfig} />
        </div>
      </div>
    </div>
  );
};
