import type { IModelConfig } from '@teable/openapi';
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';

const toNumber = (value: string) => {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};

/** Per-model display name and limits, stored in the provider's modelConfigs. */
export const ModelConfigPopover = ({
  model,
  config,
  onChange,
}: {
  model: string;
  config: IModelConfig | undefined;
  onChange: (config: IModelConfig) => void;
}) => {
  const { t } = useTranslation('common');
  const set = (patch: Partial<IModelConfig>) => onChange({ ...config, ...patch });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`${model} settings`}>
          <ChevronRight className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <p className="truncate font-mono text-xs text-muted-foreground">{model}</p>
        <div className="space-y-1">
          <Label className="text-xs">
            {t('admin.setting.ai.providers.modelLabel', 'Display name')}
          </Label>
          <Input
            value={config?.label ?? ''}
            placeholder={model}
            onChange={(e) => set({ label: e.target.value || undefined })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">
              {t('admin.setting.ai.providers.contextWindow', 'Context window')}
            </Label>
            <Input
              inputMode="numeric"
              value={config?.contextWindow ?? ''}
              onChange={(e) => set({ contextWindow: toNumber(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {t('admin.setting.ai.providers.maxOutput', 'Max output')}
            </Label>
            <Input
              inputMode="numeric"
              value={config?.maxTokens ?? ''}
              onChange={(e) => set({ maxTokens: toNumber(e.target.value) })}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
