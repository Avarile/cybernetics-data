import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ICreateAiProviderRo, ITestAiProviderRo, IUpdateAiProviderRo } from '@teable/openapi';
import {
  createAiProvider,
  deleteAiProvider,
  getAiEnvStatus,
  getAiProviderModels,
  listAiProviders,
  testAiProvider,
  testAiProviderModels,
  updateAiProvider,
} from '@teable/openapi';

/** One key for the provider list; everything that shows providers or models refetches from it. */
export const AI_PROVIDERS_QUERY_KEY = ['ai-providers'] as const;

export const useAiProviders = () =>
  useQuery({ queryKey: AI_PROVIDERS_QUERY_KEY, queryFn: listAiProviders });

export function useProviderMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_QUERY_KEY });
    // aiConfig (masked) also lists providers, for the default model pickers.
    queryClient.invalidateQueries({ queryKey: ['setting'] });
  };
  const create = useMutation({
    mutationFn: (ro: ICreateAiProviderRo) => createAiProvider(ro),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ro }: { id: string; ro: IUpdateAiProviderRo }) => updateAiProvider(id, ro),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAiProvider(id),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (ro: ITestAiProviderRo) => testAiProvider(ro),
    // A saved provider's health changes after a test.
    onSuccess: (_res, ro) => (ro.providerId && !ro.draft ? invalidate() : undefined),
  });
  const testModels = useMutation({
    mutationFn: ({ id, models }: { id: string; models: string[] }) =>
      testAiProviderModels(id, { models }),
    onSuccess: invalidate,
  });
  const fetchModels = useMutation({ mutationFn: (id: string) => getAiProviderModels(id) });
  return { create, update, remove, test, testModels, fetchModels, invalidate };
}

/** Whether an env var may hold a key and is set. Never returns its value. */
export const useEnvStatus = (name: string) =>
  useQuery({
    queryKey: ['ai-env-status', name],
    queryFn: () => getAiEnvStatus(name),
    enabled: /^[A-Z][A-Z0-9_]{1,63}$/.test(name),
    staleTime: 10_000,
  });
