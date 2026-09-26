import { Button } from '@teable/ui-lib/shadcn';
import { Network } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { encodeQuery } from './utils/queryCodec';

/**
 * The graph scoped to one table through one of its views. Kept free of graph
 * imports beyond the codec so the table page does not pull in three.js.
 */
export const graphHrefFor = (
  baseId: string,
  scope: { tableId: string; viewId?: string; focusRecordId?: string }
): string => {
  const q = encodeQuery({ tables: [{ tableId: scope.tableId, viewId: scope.viewId }] });
  const focus = scope.focusRecordId ? `&focus=rec:${scope.focusRecordId}` : '';
  return `/base/${baseId}/graph?q=${q}${focus}`;
};

export const ShowInGraphButton = (props: { baseId: string; tableId: string; viewId?: string }) => {
  const { t } = useTranslation(['common']);
  return (
    <Button variant="ghost" size="icon-xs" title={t('common:noun.graph')} asChild>
      <Link href={graphHrefFor(props.baseId, props)}>
        <Network className="size-4" />
      </Link>
    </Button>
  );
};
