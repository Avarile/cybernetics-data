import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ISchemaPackCatalogVo, ISchemaPackPlanRo, SchemaPackId } from '@teable/openapi';
import { getSchemaPackCatalog, installSchemaPacks, planSchemaPackInstall } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useCallback } from 'react';

export const useSchemaPackCatalog = () =>
  useQuery({
    queryKey: ReactQueryKeys.schemaPackCatalog(),
    queryFn: () => getSchemaPackCatalog().then((res) => res.data),
    staleTime: Infinity,
  });

/** The exact plan the server will execute: Review shows these numbers, not estimates. */
export const useInstallPlan = (ro: ISchemaPackPlanRo, enabled: boolean) =>
  useQuery({
    queryKey: ReactQueryKeys.schemaPackPlan(JSON.stringify(ro)),
    queryFn: () => planSchemaPackInstall(ro).then((res) => res.data),
    enabled: enabled && ro.packs.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

export const useInstallSchemaPacks = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: installSchemaPacks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.recentlyBase() });
    },
  });
};

/** Optional table keys of a pack, for the reducer. */
export const useOptionalOf = (catalog: ISchemaPackCatalogVo | undefined) =>
  useCallback(
    (pack: SchemaPackId) =>
      catalog?.packs
        .find((p) => p.id === pack)
        ?.tables.filter((t) => t.optional)
        .map((t) => t.key) ?? [],
    [catalog]
  );
