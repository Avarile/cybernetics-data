import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ISchemaPackAddRo,
  ISchemaPackCatalogVo,
  ISchemaPackInstallRo,
  ISchemaPackPlanRo,
  SchemaPackId,
} from '@teable/openapi';
import {
  addSchemaPacks,
  getSchemaPackCatalog,
  installSchemaPacks,
  planSchemaPackAdd,
  planSchemaPackInstall,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useCallback } from 'react';

export const useSchemaPackCatalog = () =>
  useQuery({
    queryKey: ReactQueryKeys.schemaPackCatalog(),
    queryFn: () => getSchemaPackCatalog().then((res) => res.data),
    staleTime: Infinity,
  });

/**
 * The exact plan the server will execute: Review shows these numbers, not estimates. A plan for
 * a new base depends only on the request; a plan into a base also depends on what is in it now.
 */
export const useInstallPlan = (
  ro: ISchemaPackPlanRo,
  baseId: string | undefined,
  enabled: boolean
) =>
  useQuery({
    queryKey: ReactQueryKeys.schemaPackPlan(JSON.stringify({ ...ro, baseId })),
    queryFn: () =>
      (baseId ? planSchemaPackAdd(baseId, ro) : planSchemaPackInstall(ro)).then((res) => res.data),
    enabled: enabled && ro.packs.length > 0,
    placeholderData: keepPreviousData,
    staleTime: baseId ? 0 : Infinity,
  });

export type IInstallRequest =
  | { kind: 'new'; ro: ISchemaPackInstallRo }
  | { kind: 'existing'; baseId: string; ro: ISchemaPackAddRo };

export const useInstallSchemaPacks = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: IInstallRequest) =>
      request.kind === 'existing'
        ? addSchemaPacks(request.baseId, request.ro)
        : installSchemaPacks(request.ro),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.recentlyBase() });
      // Any plan computed before this install is now wrong about what the base holds.
      queryClient.removeQueries({ queryKey: ReactQueryKeys.schemaPackPlan() });
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
