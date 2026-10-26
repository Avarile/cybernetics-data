import type { LLMProviderType } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { LLM_PROVIDER_ICONS } from '../../blocks/admin/setting/components/ai-config/constant';

export const ProviderIcon = ({
  type,
  className,
}: {
  type: LLMProviderType;
  className?: string;
}) => {
  const Icon = (LLM_PROVIDER_ICONS as Record<string, React.ComponentType<{ className?: string }>>)[
    type
  ];
  return Icon ? <Icon className={cn('size-5 shrink-0', className)} /> : null;
};
