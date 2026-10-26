import type { IGatewayModel, ISettingVo } from '@teable/openapi';
import { Card, CardContent, CardHeader, CardTitle, Label } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { buildPickerGroups } from '../../../components/ai/model-picker-options';
import { ModelPicker } from '../../../components/ai/ModelPicker';
import { useAiProviders } from './providers/useProviders';

type IChatModel = NonNullable<NonNullable<ISettingVo['aiConfig']>['chatModel']>;

interface IDefaultModelsCardProps {
  chatModel: IChatModel | null | undefined;
  gatewayModels: IGatewayModel[];
  onChange: (chatModel: IChatModel) => void;
}

/**
 * The instance's default chat models (large, medium, small). Medium and small fall back to the
 * large model when unset. Stored keys are left as they are until the admin picks another model.
 */
export const DefaultModelsCard = ({
  chatModel,
  gatewayModels,
  onChange,
}: IDefaultModelsCardProps) => {
  const { t } = useTranslation('common');
  const { data } = useAiProviders();
  const groups = useMemo(
    () => buildPickerGroups(data?.providers ?? [], gatewayModels),
    [data?.providers, gatewayModels]
  );
  const set = (patch: Partial<IChatModel>) => onChange({ ...chatModel, ...patch });

  return (
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
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t('admin.setting.ai.providers.modelLarge', 'Main model (large)')}</Label>
          <ModelPicker
            value={chatModel?.lg}
            groups={groups}
            onChange={(lg) => set({ lg })}
            disabled={groups.length === 0}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('admin.setting.ai.providers.modelMedium', 'Medium tasks')}</Label>
            <ModelPicker
              value={chatModel?.md && chatModel.md !== chatModel.lg ? chatModel.md : undefined}
              groups={groups}
              onChange={(md) => set({ md })}
              clearLabel={t('admin.setting.ai.providers.sameAsMain', 'Same as main model')}
              onClear={() => set({ md: chatModel?.lg })}
              disabled={!chatModel?.lg}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.setting.ai.providers.modelSmall', 'Small tasks')}</Label>
            <ModelPicker
              value={chatModel?.sm && chatModel.sm !== chatModel.lg ? chatModel.sm : undefined}
              groups={groups}
              onChange={(sm) => set({ sm })}
              clearLabel={t('admin.setting.ai.providers.sameAsMain', 'Same as main model')}
              onClear={() => set({ sm: chatModel?.lg })}
              disabled={!chatModel?.lg}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
