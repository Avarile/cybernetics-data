import type { IAiProviderVo, IProviderHealthStatus } from '@teable/openapi';
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

const statusStyle: Record<IProviderHealthStatus, string> = {
  ready: 'bg-green-500/10 text-green-700 dark:text-green-400',
  untested: 'bg-muted text-muted-foreground',
  'not-set': 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  error: 'bg-red-500/10 text-red-700 dark:text-red-400',
  disabled: 'bg-muted text-muted-foreground line-through',
};

const dotStyle: Record<IProviderHealthStatus, string> = {
  ready: 'bg-green-500',
  untested: 'bg-muted-foreground/50',
  'not-set': 'bg-amber-500',
  error: 'bg-red-500',
  disabled: 'bg-muted-foreground/40',
};

/** Server-computed provider health; the tooltip explains what to do. */
export const ProviderHealthChip = ({ provider }: { provider: IAiProviderVo }) => {
  const { t } = useTranslation('common');
  const label: Record<IProviderHealthStatus, string> = {
    ready: t('admin.setting.ai.providers.status.ready', 'Ready'),
    untested: t('admin.setting.ai.providers.status.untested', 'Untested'),
    'not-set': t('admin.setting.ai.providers.status.notSet', 'Not set'),
    error: t('admin.setting.ai.providers.status.error', 'Error'),
    disabled: t('admin.setting.ai.providers.status.disabled', 'Disabled'),
  };
  const tip =
    provider.status === 'error'
      ? provider.lastError
      : provider.status === 'not-set'
        ? provider.keySource === 'env'
          ? t('admin.setting.ai.providers.status.envMissing', '{{name}} is not set on the server', {
              name: provider.apiKeyEnv ?? 'AI_GATEWAY_API_KEY',
            })
          : t('admin.setting.ai.providers.status.keyMissing', 'This provider needs an API key')
        : provider.lastTestedAt
          ? t('admin.setting.ai.providers.status.testedAt', 'Last tested {{at}}', {
              at: new Date(provider.lastTestedAt).toLocaleString(),
            })
          : undefined;

  const chip = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        statusStyle[provider.status]
      )}
      data-testid={`provider-status-${provider.id}`}
    >
      <span className={cn('size-1.5 rounded-full', dotStyle[provider.status])} />
      {label[provider.status]}
    </span>
  );
  if (!tip) return chip;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{String(tip)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
