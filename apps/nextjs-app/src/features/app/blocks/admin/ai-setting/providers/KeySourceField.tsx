import { Badge, Button, Input, Label, RadioGroup, RadioGroupItem } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { IKeyMode } from './provider-form';
import { useEnvStatus } from './useProviders';

interface IKeySourceFieldProps {
  mode: IKeyMode;
  onModeChange: (mode: IKeyMode) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  apiKeyEnv: string;
  onApiKeyEnvChange: (value: string) => void;
  /** Preview of the stored key when editing a provider that has one. */
  storedPreview?: string;
  /** Whether "No key" is offered (local and self-hosted types). */
  allowNone: boolean;
  error?: string;
}

/**
 * Where the provider's key comes from. A stored key is never shown: only its preview, with Replace
 * and Remove. An env var shows whether it is set on the server, never its value.
 */
export const KeySourceField = (props: IKeySourceFieldProps) => {
  const { mode, onModeChange, apiKey, onApiKeyChange, apiKeyEnv, onApiKeyEnvChange } = props;
  const { storedPreview, allowNone, error } = props;
  const { t } = useTranslation('common');
  const { data: envStatus } = useEnvStatus(mode === 'env' ? apiKeyEnv : '');
  const hasStored = Boolean(storedPreview);
  const radioMode = mode === 'stored' ? 'paste' : mode;

  return (
    <div className="space-y-2">
      <Label>{t('admin.setting.ai.providers.apiKey', 'API key')}</Label>
      <RadioGroup
        value={radioMode}
        onValueChange={(value) => onModeChange(value as IKeyMode)}
        className="flex flex-wrap gap-4"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="paste" />
          {t('admin.setting.ai.providers.keyPaste', 'Paste')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="env" />
          {t('admin.setting.ai.providers.keyEnv', 'Env var')}
        </label>
        {allowNone && (
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="none" />
            {t('admin.setting.ai.providers.keyNone', 'No key')}
          </label>
        )}
      </RadioGroup>

      {mode === 'stored' && hasStored && (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('admin.setting.ai.providers.keyStored', 'Stored')}
          </span>
          <code className="font-mono text-xs">{storedPreview}</code>
          <div className="ml-auto flex gap-1">
            <Button type="button" size="xs" variant="outline" onClick={() => onModeChange('paste')}>
              {t('admin.setting.ai.providers.keyReplace', 'Replace')}
            </Button>
            {allowNone && (
              <Button type="button" size="xs" variant="ghost" onClick={() => onModeChange('none')}>
                {t('admin.setting.ai.providers.keyRemove', 'Remove')}
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-1">
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={
              hasStored
                ? t(
                    'admin.setting.ai.providers.keyReplacePlaceholder',
                    'New key (replaces {{preview}})',
                    {
                      preview: storedPreview,
                    }
                  )
                : t('admin.setting.ai.providers.keyPlaceholder', 'Paste the API key')
            }
            data-testid="provider-api-key"
          />
          {hasStored && (
            <Button
              type="button"
              size="xs"
              variant="link"
              className="h-auto p-0"
              onClick={() => onModeChange('stored')}
            >
              {t('admin.setting.ai.providers.keyKeep', 'Keep the stored key')}
            </Button>
          )}
        </div>
      )}

      {mode === 'env' && (
        <div className="flex items-center gap-2">
          <Input
            value={apiKeyEnv}
            onChange={(e) => onApiKeyEnvChange(e.target.value.toUpperCase())}
            placeholder="OPENROUTER_API_KEY"
            className="font-mono"
            data-testid="provider-api-key-env"
          />
          {envStatus && (
            <Badge variant={envStatus.set ? 'secondary' : 'outline'} className="shrink-0">
              {!envStatus.allowed
                ? t('admin.setting.ai.providers.envNotAllowed', 'not allowed')
                : envStatus.set
                  ? t('admin.setting.ai.providers.envSet', 'set')
                  : t('admin.setting.ai.providers.envNotSet', 'not set')}
            </Badge>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};
