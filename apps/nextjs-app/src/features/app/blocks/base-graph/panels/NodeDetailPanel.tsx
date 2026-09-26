import { X } from '@teable/icons';
import { CellValue } from '@teable/sdk/components';
import { Button, Skeleton } from '@teable/ui-lib/shadcn';
import { ExternalLink, Network } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useGraphNode } from '../hooks/useGraphData';
import { useTableFields } from '../hooks/useTableFields';

interface INodeDetailPanelProps {
  recordId: string;
  tableId: string;
  /** The table's tree field in the current query, for the breadcrumb. */
  hierarchyFieldId?: string;
  isExpanding: boolean;
  onExpand: (linkFieldIds?: string[]) => void;
  onOpenRecord: () => void;
  onClose: () => void;
}

const formatTime = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
};

const isEmptyCell = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

export const NodeDetailPanel = (props: INodeDetailPanelProps) => {
  const { recordId, tableId, hierarchyFieldId, isExpanding, onExpand, onOpenRecord, onClose } =
    props;
  const { t } = useTranslation(['baseGraph']);
  const { data, isLoading, isError } = useGraphNode(recordId, tableId, hierarchyFieldId);
  const fields = useTableFields(tableId);
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  const shown = (data?.fields ?? []).filter((f) => !isEmptyCell(f.cellValue));
  const links = (data?.linkCounts ?? []).filter((l) => l.count > 0);

  return (
    // 28rem ≈ 70 characters per line at text-xs; max-w caps it against the canvas.
    <div className="pointer-events-auto flex max-h-full w-[28rem] max-w-[45%] flex-col rounded-md border bg-background/95 shadow-lg backdrop-blur">
      <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <h2 className="truncate text-sm font-semibold">{data?.label || recordId}</h2>
          )}
          {data && <p className="text-[11px] text-muted-foreground">{data.tableName}</p>}
          {data?.ancestors && data.ancestors.length > 0 && (
            <p className="mt-0.5 flex text-[11px] text-muted-foreground">
              <span className="shrink-0">{t('baseGraph:detail.path')}:&nbsp;</span>
              {/* rtl clips the START, keeping the immediate parent visible. */}
              <span className="min-w-0 truncate" style={{ direction: 'rtl' }}>
                <bdi dir="ltr">{data.ancestors.map((a) => a.label).join(' / ')}</bdi>
              </span>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onOpenRecord}
          title={t('baseGraph:detail.openRecord')}
        >
          <ExternalLink className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('baseGraph:detail.close')}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {isError && <p className="text-xs text-destructive">{t('baseGraph:error.title')}</p>}
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        )}

        {links.length > 0 && (
          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
                {t('baseGraph:detail.links')}
              </h3>
              <Button
                variant="ghost"
                size="xs"
                className="h-5 text-[11px]"
                disabled={isExpanding}
                onClick={() => onExpand()}
              >
                <Network className="size-3" />
                {t('baseGraph:detail.expandAll')}
              </Button>
            </div>
            <ul className="space-y-0.5 text-xs">
              {links.map((link) => (
                <li key={link.fieldId} className="flex items-center gap-2">
                  <span className="truncate">{link.name}</span>
                  <span className="text-muted-foreground">{link.count}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="ml-auto h-5 text-[11px]"
                    disabled={isExpanding}
                    onClick={() => onExpand([link.fieldId])}
                  >
                    {t('baseGraph:detail.expand')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {shown.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
              {t('baseGraph:detail.fields')}
            </h3>
            <dl className="space-y-1.5">
              {shown.map((cell) => {
                const field = fieldById.get(cell.fieldId);
                return (
                  <div key={cell.fieldId} className="text-xs">
                    <dt className="text-[11px] text-muted-foreground">{cell.name}</dt>
                    <dd className="break-words">
                      {field ? (
                        <CellValue field={field} value={cell.cellValue} readonly />
                      ) : (
                        String(cell.cellValue)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}

        {data && (
          <section className="space-y-0.5 text-[11px] text-muted-foreground">
            {formatTime(data.createdTime) && (
              <p>{t('baseGraph:detail.created', { time: formatTime(data.createdTime) })}</p>
            )}
            {formatTime(data.lastModifiedTime) && (
              <p>{t('baseGraph:detail.updated', { time: formatTime(data.lastModifiedTime) })}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
};
