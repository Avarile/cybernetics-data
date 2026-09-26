import type { IFilter } from '@teable/core';
import { FilterWithTable, useFieldFilterLinkContext } from '@teable/sdk/components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useTableFields } from '../hooks/useTableFields';

interface ITableFilterDialogProps {
  tableId: string;
  tableName: string;
  value: IFilter | undefined;
  onApply: (filter: IFilter | undefined) => void;
}

/**
 * The grid's own filter editor. Edits are drafted locally and applied once:
 * applying writes the URL, and every write is a new graph query.
 */
export const TableFilterDialog = (props: ITableFilterDialogProps) => {
  const { tableId, tableName, value, onApply } = props;
  const { t } = useTranslation(['baseGraph']);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IFilter | null>(value ?? null);
  const fields = useTableFields(open ? tableId : null);
  const context = useFieldFilterLinkContext(tableId, undefined, true);

  const hasFilter = Boolean(value?.filterSet?.length);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value ?? null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={hasFilter ? 'secondary' : 'outline'} size="xs" className="h-6 text-[11px]">
          {hasFilter
            ? `${t('baseGraph:query.filter')} (${value?.filterSet.length})`
            : t('baseGraph:query.editFilter')}
        </Button>
      </DialogTrigger>
      <DialogContent className="min-w-96 max-w-fit">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {t('baseGraph:query.filter')} · {tableName}
          </DialogTitle>
        </DialogHeader>
        {fields.length > 0 && (
          <FilterWithTable fields={fields} value={draft} context={context} onChange={setDraft} />
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onApply(undefined);
              setOpen(false);
            }}
          >
            {t('baseGraph:query.clearFilter')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply(draft?.filterSet?.length ? draft : undefined);
              setOpen(false);
            }}
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
