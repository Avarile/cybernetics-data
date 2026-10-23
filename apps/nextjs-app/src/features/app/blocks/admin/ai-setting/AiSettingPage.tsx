import { useIsHydrated } from '@cybernetics/sdk/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ISettingVo, IUpdateSettingRo } from '@teable/openapi';
import { getSetting, updateSetting } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AIConfigurationStatus } from '../setting/components/ai-config/AIConfigurationStatus';
import { AIControlCard } from '../setting/components/ai-config/AIControlCard';
import { AIConfigFormWizard } from '../setting/components/ai-config/AiFormWizard';
import { AppBuilderConfig } from './AppBuilderConfig';

export interface IAiSettingPageProps {
  settingServerData?: ISettingVo;
}

// Maps AIConfigurationStatus section names to wizard step indices
const SECTION_TO_STEP: Record<string, number> = {
  enable: 0,
  gateway: 0,
  providers: 0,
  'gateway-models': 1,
  'chat-model': 2,
};

export const AiSettingPage = ({ settingServerData }: IAiSettingPageProps) => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const router = useRouter();
  const llmRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const isHydrated = useIsHydrated();
  const [wizardStep, setWizardStep] = useState(-1);

  const { data: setting = settingServerData } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
  });

  const { mutateAsync: mutateUpdateSetting } = useMutation({
    mutationFn: (props: IUpdateSettingRo) => updateSetting(props),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting'] });
    },
  });

  useEffect(() => {
    const { anchor } = router.query;
    if (anchor === 'llm') {
      setTimeout(() => llmRef.current?.scrollIntoView({ behavior: 'smooth' }), 500);
    } else if (anchor === 'app') {
      setTimeout(() => appRef.current?.scrollIntoView({ behavior: 'smooth' }), 500);
    }
  }, [router.query]);

  const handleNavigate = useCallback((section: string) => {
    const step = SECTION_TO_STEP[section] ?? 0;
    setWizardStep(step);
    setTimeout(() => llmRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  if (!setting || !isHydrated) return null;

  const setAiConfig = (aiConfig: NonNullable<ISettingVo['aiConfig']>) => {
    mutateUpdateSetting({ aiConfig } as IUpdateSettingRo);
  };

  const onControlChange = ({ disableActions }: { disableActions: string[] }) => {
    mutateUpdateSetting({
      // disableActions lives under aiConfig.capabilities in the schema; writing
      // it at the top level silently produced a field the server never reads.
      aiConfig: {
        ...setting.aiConfig,
        capabilities: { ...setting.aiConfig?.capabilities, disableActions },
      },
    } as IUpdateSettingRo);
  };

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
        {/* AI Configuration Status — checklist with click-to-navigate */}
        <AIConfigurationStatus aiConfig={setting.aiConfig} onNavigate={handleNavigate} />

        {/* LLM Provider Setup Wizard */}
        <div ref={llmRef}>
          <AIConfigFormWizard
            aiConfig={setting.aiConfig}
            setAiConfig={setAiConfig}
            currentStep={wizardStep}
            onStepChange={setWizardStep}
          />
        </div>

        {/* AI Feature Enable/Disable Toggles */}
        <AIControlCard
          disableActions={setting.aiConfig?.capabilities?.disableActions ?? []}
          onChange={onControlChange}
        />

        {/* App Builder Configuration */}
        <div ref={appRef}>
          <AppBuilderConfig appConfig={setting.appConfig} onSave={saveAppConfig} />
        </div>
      </div>
    </div>
  );
};
