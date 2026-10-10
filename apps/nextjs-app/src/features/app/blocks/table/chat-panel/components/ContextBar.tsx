import { X } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IContextBarProps {
  rowCount: number;
  onDismiss: () => void;
}

export const ContextBar = ({ rowCount, onDismiss }: IContextBarProps) => {
  const { t } = useTranslation('common');

  if (rowCount === 0) return null;

  return (
    <div className="flex shrink-0 items-center justify-between bg-accent/50 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">
        {t('ai.chat.rowsSelected', '{{count}} rows selected as context', { count: rowCount })}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="size-5 p-0"
        onClick={onDismiss}
        aria-label={t('ai.chat.removeContext', 'Remove selected rows from context')}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
};
