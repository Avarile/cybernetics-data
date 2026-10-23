import { ReactQueryKeys } from '@cybernetics/sdk/config';
import type { IFieldInstance } from '@cybernetics/sdk/model';
import { createFieldInstance } from '@cybernetics/sdk/model';
import { useQuery } from '@tanstack/react-query';
import { getFields } from '@teable/openapi';
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
