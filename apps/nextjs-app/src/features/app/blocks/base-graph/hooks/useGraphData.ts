import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { IBaseGraphExpandRo, IBaseGraphQueryRo } from '@teable/openapi';
import {
  expandBaseGraph,
  getBaseGraphNode,
  getBaseGraphSchema,
  queryBaseGraph,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { queryHash } from '../utils/queryCodec';

/**
 * The shared QueryCache.onError swallows 4xx on queries, so a failed fetch shows
 * the user nothing on its own — consumers render their own error state.
 */
export const useGraphSchema = () => {
  const baseId = useBaseId();
  return useQuery({
    queryKey: ReactQueryKeys.baseGraphSchema(baseId as string),
    queryFn: () => getBaseGraphSchema(baseId as string).then((res) => res.data),
    enabled: Boolean(baseId),
    staleTime: 5 * 60 * 1000,
  });
};

/**
 * keepPreviousData: changing a filter keeps the current graph on screen until
 * the new one arrives, instead of tearing the scene down to a skeleton.
 * Focus refetch is cheap because the server answers an unchanged graph with 304.
 */
export const useBaseGraph = (ro: IBaseGraphQueryRo | null) => {
  const baseId = useBaseId();
  return useQuery({
    queryKey: ReactQueryKeys.baseGraph(baseId as string, ro ? queryHash(ro) : ''),
    queryFn: () =>
      queryBaseGraph(baseId as string, ro as IBaseGraphQueryRo).then((res) => res.data),
    enabled: Boolean(baseId && ro),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
};

export const useGraphNode = (
  recordId: string | null,
  tableId: string | null,
  hierarchyFieldId?: string
) => {
  const baseId = useBaseId();
  return useQuery({
    queryKey: ReactQueryKeys.baseGraphNode(
      baseId as string,
      recordId as string,
      tableId as string,
      hierarchyFieldId
    ),
    queryFn: () =>
      getBaseGraphNode(baseId as string, recordId as string, {
        tableId: tableId as string,
        hierarchyFieldId,
      }).then((res) => res.data),
    enabled: Boolean(baseId && recordId && tableId),
    staleTime: 60 * 1000,
  });
};

export const useExpandNode = () => {
  const baseId = useBaseId();
  return useMutation({
    mutationFn: (ro: IBaseGraphExpandRo) =>
      expandBaseGraph(baseId as string, ro).then((res) => res.data),
  });
};
