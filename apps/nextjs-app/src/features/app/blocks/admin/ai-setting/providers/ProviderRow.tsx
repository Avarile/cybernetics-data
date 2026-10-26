import type { IAiProviderVo } from '@teable/openapi';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { ProviderIcon } from '../../../../components/ai/ProviderIcon';
import { ProviderHealthChip } from './ProviderHealthChip';

export interface IProviderRowActions {
  onEdit: (p: IAiProviderVo) => void;
  onTest: (p: IAiProviderVo) => void;
  onRefreshModels: (p: IAiProviderVo) => void;
  onDuplicate: (p: IAiProviderVo) => void;
  onToggleEnabled: (p: IAiProviderVo) => void;
  onDelete: (p: IAiProviderVo) => void;
}

/** One provider: a row on wide screens, a stacked card on phones. */
export const ProviderRow = ({
  provider,
  actions,
}: {
  provider: IAiProviderVo;
  actions: IProviderRowActions;
}) => {
  const { t } = useTranslation('common');
  const keyText =
    provider.keySource === 'stored'
      ? `${t('admin.setting.ai.providers.keyStored', 'Stored')} ${provider.apiKeyPreview ?? ''}`
      : provider.keySource === 'env'
        ? `env ${provider.apiKeyEnv ?? 'AI_GATEWAY_API_KEY'}${provider.envSet ? '' : ` — ${t('admin.setting.ai.providers.envNotSet', 'not set')}`}`
        : t('admin.setting.ai.providers.keyNone', 'No key');

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
      data-testid={`provider-row-${provider.id}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon type={provider.type} />
        <div className="min-w-0">
          <button
            type="button"
            className="block truncate text-left text-sm font-medium hover:underline"
            onClick={() => actions.onEdit(provider)}
          >
            {provider.name}
          </button>
          <code className="block truncate text-xs text-muted-foreground">{provider.id}</code>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:flex-nowrap">
        <span className="max-w-48 truncate font-mono" title={keyText}>
          {keyText}
        </span>
        <span className="shrink-0">
          {t('admin.setting.ai.providers.modelCount', '{{count}} models', {
            count: provider.modelCount,
          })}
        </span>
        <ProviderHealthChip provider={provider} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-8 sm:ml-0"
              aria-label={t('admin.setting.ai.providers.actions', 'Provider actions')}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => actions.onEdit(provider)}>
              {t('actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onTest(provider)}>
              {t('admin.setting.ai.providers.testNow', 'Test now')}
            </DropdownMenuItem>
            {!provider.managedModels && (
              <DropdownMenuItem onClick={() => actions.onRefreshModels(provider)}>
                {t('admin.setting.ai.providers.refreshModels', 'Refresh models')}
              </DropdownMenuItem>
            )}
            {!provider.managedModels && (
              <DropdownMenuItem onClick={() => actions.onDuplicate(provider)}>
                {t('admin.setting.ai.providers.duplicate', 'Duplicate')}
              </DropdownMenuItem>
            )}
            {!provider.managedModels && (
              <DropdownMenuItem onClick={() => actions.onToggleEnabled(provider)}>
                {provider.enabled === false
                  ? t('admin.setting.ai.providers.enable', 'Enable')
                  : t('admin.setting.ai.providers.disable', 'Disable')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => actions.onDelete(provider)}
            >
              {t('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
