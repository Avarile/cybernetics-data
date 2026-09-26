import { useQuery } from '@tanstack/react-query';
import { getFields } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { IFieldInstance } from '@teable/sdk/model';
import { createFieldInstance } from '@teable/sdk/model';
import { useMemo } from 'react';

/** Field instances for one table — what the SDK filter editor and cell renderers need. */
export const useTableFields = (tableId: string | null | undefined) => {
  const { data = [] } = useQuery({
    queryKey: ReactQueryKeys.fieldList(tableId as string),
    queryFn: () => getFields(tableId as string).then((res) => res.data),
    enabled: Boolean(tableId),
  });
  return useMemo(() => data.map((f) => createFieldInstance(f) as IFieldInstance), [data]);
};
