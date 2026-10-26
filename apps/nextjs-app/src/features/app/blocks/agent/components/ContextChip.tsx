import { X } from 'lucide-react';
import { useTranslation } from 'next-i18next';

export interface IContextChipProps {
  tableName?: string;
  selectedCount?: number;
  onDismiss: () => void;
}

/** Where the chat was opened from: a hint for the agent, never a limit. */
export const ContextChip = ({ tableName, selectedCount, onDismiss }: IContextChipProps) => {
  const { t } = useTranslation('common');
  if (!tableName) return null;
  return (
    <div className="flex items-center gap-1 px-3 pt-2">
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
        <span className="truncate">{tableName}</span>
        {selectedCount ? (
          <span>
            · {String(t('agent.context.selected', '{{count}} selected', { count: selectedCount }))}
          </span>
        ) : null}
        <button
          type="button"
          className="ml-0.5 rounded-full hover:text-foreground"
          aria-label={t('agent.context.remove', 'Remove context')}
          onClick={onDismiss}
        >
          <X className="size-3" />
        </button>
      </span>
    </div>
  );
};
