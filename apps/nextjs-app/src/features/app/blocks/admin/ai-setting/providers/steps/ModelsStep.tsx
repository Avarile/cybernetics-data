import type { ITestAiProviderModelsVo } from '@teable/openapi';
import { Badge, Button, Checkbox, Input, Label, Switch } from '@teable/ui-lib/shadcn';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { ModelConfigPopover } from '../ModelConfigPopover';
import type { IProviderFormState } from '../provider-form';

type IModelResult = ITestAiProviderModelsVo['results'][number];

interface IModelsStepProps {
  state: IProviderFormState;
  onChange: (state: IProviderFormState) => void;
  /** Models listed by the endpoint (from Test connection or Refresh). */
  available: string[];
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Testing needs a saved provider (the key stays on the server). */
  canTest: boolean;
  onTestSelected: (models: string[]) => void;
  testing: boolean;
  results: Record<string, IModelResult>;
}

/** Step 3: which models this provider exposes, plus per-model settings and ability tests. */
export const ModelsStep = (props: IModelsStepProps) => {
  const { state, onChange, available, onRefresh, refreshing, canTest } = props;
  const { onTestSelected, testing, results } = props;
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');

  const all = useMemo(
    () => [...new Set([...state.models, ...available])].sort((a, b) => a.localeCompare(b)),
    [state.models, available]
  );
  const shown = all.filter((m) => m.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = new Set(state.models);

  const toggle = (model: string, on: boolean) =>
    onChange({
      ...state,
      models: on ? [...state.models, model] : state.models.filter((m) => m !== model),
    });
  const addManual = () => {
    const ids = manual
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m && !selected.has(m));
    if (ids.length) onChange({ ...state, models: [...state.models, ...ids] });
    setManual('');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.setting.ai.providers.searchModels', 'Search models')}
            className="pl-8"
          />
        </div>
        {onRefresh && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        )}
      </div>

      <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {shown.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {t(
              'admin.setting.ai.providers.noModels',
              'No models yet. Test the connection to list them, or add model ids below.'
            )}
          </p>
        )}
        {shown.map((model) => {
          const result = results[model];
          const tags = result?.tags ?? state.modelConfigs[model]?.tags ?? [];
          return (
            <div key={model} className="flex items-center gap-2 px-3 py-1.5">
              <Checkbox
                checked={selected.has(model)}
                onCheckedChange={(v) => toggle(model, v === true)}
                aria-label={model}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{model}</span>
              {result && !result.ok && (
                <span className="truncate text-xs text-destructive" title={result.error}>
                  {t('admin.setting.ai.providers.modelFailed', 'failed')}
                </span>
              )}
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="px-1.5 text-[10px]">
                  {tag}
                </Badge>
              ))}
              {selected.has(model) && (
                <ModelConfigPopover
                  model={model}
                  config={state.modelConfigs[model]}
                  onChange={(config) =>
                    onChange({ ...state, modelConfigs: { ...state.modelConfigs, [model]: config } })
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder={t('admin.setting.ai.providers.addModelPlaceholder', 'Add model id manually')}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={addManual} disabled={!manual.trim()}>
          {t('admin.setting.ai.providers.addModel', 'Add')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Switch
            checked={state.fetchModels}
            onCheckedChange={(fetchModels) => onChange({ ...state, fetchModels })}
          />
          {t('admin.setting.ai.providers.keepInSync', 'Keep in sync with /models')}
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canTest || testing || state.models.length === 0}
          onClick={() => onTestSelected(state.models)}
          title={
            canTest
              ? undefined
              : t('admin.setting.ai.providers.saveToTest', 'Save the provider to test its models')
          }
        >
          {testing && <Loader2 className="size-4 animate-spin" />}
          {t('admin.setting.ai.providers.testSelected', 'Test selected')}
        </Button>
      </div>
    </div>
  );
};
