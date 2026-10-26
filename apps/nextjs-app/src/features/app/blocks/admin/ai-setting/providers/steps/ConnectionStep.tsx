import type { ITestAiProviderVo } from '@teable/openapi';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { HeadersEditor } from '../HeadersEditor';
import { KeySourceField } from '../KeySourceField';
import { BASE_URL_REQUIRED_TYPES, KEYLESS_TYPES } from '../presets';
import type { IProviderFormErrors, IProviderFormState } from '../provider-form';
import { withName } from '../provider-form';

interface IConnectionStepProps {
  state: IProviderFormState;
  onChange: (state: IProviderFormState) => void;
  errors: IProviderFormErrors;
  creating: boolean;
  storedPreview?: string;
  headerHints?: Record<string, string>;
  baseUrlPlaceholder?: string;
  onTest: () => void;
  testing: boolean;
  testResult?: ITestAiProviderVo;
  /** Headers live in their own tab when editing. */
  showHeaders: boolean;
}

/** Step 2: name, id, base URL, key source, headers, and "Test connection". */
export const ConnectionStep = (props: IConnectionStepProps) => {
  const { state, onChange, errors, creating, storedPreview, headerHints, onTest } = props;
  const { testing, testResult, showHeaders, baseUrlPlaceholder } = props;
  const { t } = useTranslation('common');
  const set = (patch: Partial<IProviderFormState>) => onChange({ ...state, ...patch });
  const errorText = (code?: string) =>
    code === 'required'
      ? t('admin.setting.ai.providers.errors.required', 'Required')
      : code === 'invalid'
        ? t('admin.setting.ai.providers.errors.invalid', 'Not valid')
        : code === 'taken'
          ? t('admin.setting.ai.providers.errors.taken', 'Another provider already uses this id')
          : code === 'env'
            ? t('admin.setting.ai.providers.errors.env', 'This env var is not allowed for keys')
            : code === 'duplicate'
              ? t(
                  'admin.setting.ai.providers.errors.duplicateHeader',
                  'Header names must be unique'
                )
              : undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="provider-name">{t('admin.setting.ai.providers.name', 'Name')}</Label>
        <Input
          id="provider-name"
          value={state.name}
          onChange={(e) =>
            onChange(
              creating ? withName(state, e.target.value) : { ...state, name: e.target.value }
            )
          }
        />
        {errors.name && <p className="text-xs text-destructive">{errorText(errors.name)}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="provider-id">ID</Label>
        <Input
          id="provider-id"
          value={state.id}
          disabled={!creating}
          className="font-mono"
          onChange={(e) => set({ id: e.target.value.toLowerCase(), idTouched: true })}
          data-testid="provider-id"
        />
        <p className="text-xs text-muted-foreground">
          {creating
            ? t(
                'admin.setting.ai.providers.idHelp',
                'Used in model references. It cannot change after saving.'
              )
            : t('admin.setting.ai.providers.idFixed', 'Fixed: model references use it.')}
        </p>
        {errors.id && <p className="text-xs text-destructive">{errorText(errors.id)}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="provider-base-url">
          {t('admin.setting.ai.providers.baseUrl', 'Base URL')}
          {BASE_URL_REQUIRED_TYPES.includes(state.type) ? ' *' : ''}
        </Label>
        <Input
          id="provider-base-url"
          value={state.baseUrl}
          placeholder={
            baseUrlPlaceholder ?? t('admin.setting.ai.providers.baseUrlDefault', 'Default endpoint')
          }
          onChange={(e) => set({ baseUrl: e.target.value })}
          data-testid="provider-base-url"
        />
        {errors.baseUrl && <p className="text-xs text-destructive">{errorText(errors.baseUrl)}</p>}
      </div>

      <KeySourceField
        mode={state.keyMode}
        onModeChange={(keyMode) => set({ keyMode })}
        apiKey={state.apiKey}
        onApiKeyChange={(apiKey) => set({ apiKey })}
        apiKeyEnv={state.apiKeyEnv}
        onApiKeyEnvChange={(apiKeyEnv) => set({ apiKeyEnv })}
        storedPreview={storedPreview}
        allowNone={KEYLESS_TYPES.includes(state.type)}
        error={errorText(errors.key)}
      />

      {showHeaders && (
        <Collapsible defaultOpen={state.headers.length > 0}>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
            {t('admin.setting.ai.providers.advancedHeaders', 'Advanced: headers')}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <HeadersEditor
              rows={state.headers}
              onChange={(headers) => set({ headers })}
              hints={headerHints}
              error={errorText(errors.headers)}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing}>
          {testing && <Loader2 className="size-4 animate-spin" />}
          {t('admin.setting.ai.providers.testConnection', 'Test connection')}
        </Button>
        {testResult && (
          <span
            className={
              testResult.ok
                ? 'flex items-center gap-1 text-sm text-green-700 dark:text-green-400'
                : 'flex items-center gap-1 text-sm text-destructive'
            }
            data-testid="provider-test-result"
          >
            {testResult.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
            {testResult.ok
              ? t(
                  'admin.setting.ai.providers.testOk',
                  '{{status}} · {{count}} models · {{ms}} ms',
                  {
                    status: testResult.status ?? 'OK',
                    count: testResult.models?.length ?? 0,
                    ms: testResult.latencyMs,
                  }
                )
              : [testResult.error, testResult.hint].filter(Boolean).join(' — ')}
          </span>
        )}
      </div>
    </div>
  );
};
