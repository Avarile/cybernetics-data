import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { useInstallPlan, useInstallSchemaPacks } from './hooks';

const api = vi.hoisted(() => ({
  planSchemaPackInstall: vi.fn(),
  planSchemaPackAdd: vi.fn(),
  installSchemaPacks: vi.fn(),
  addSchemaPacks: vi.fn(),
  getSchemaPackCatalog: vi.fn(),
}));
vi.mock('@teable/openapi', () => api);

const plan = { tables: [], counts: { tables: 0, fields: 0, links: 0, seedRows: 0 } };
const installed = { baseId: 'bseA', tables: [], counts: { tables: 0, fields: 0, records: 0 } };
const options = {
  timezone: 'UTC',
  currency: 'USD' as const,
  starterRows: false,
  optionalTables: [],
};
const ro = { packs: ['people' as const], optionalTables: [], starterRows: false };

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.planSchemaPackInstall.mockResolvedValue({ data: plan });
  api.planSchemaPackAdd.mockResolvedValue({ data: plan });
  api.installSchemaPacks.mockResolvedValue({ data: installed });
  api.addSchemaPacks.mockResolvedValue({ data: installed });
});

describe('useInstallPlan', () => {
  it('plans into the base through its own route, and never trusts an old answer', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useInstallPlan(ro, 'bseA', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.planSchemaPackAdd).toHaveBeenCalledWith('bseA', ro);
    expect(api.planSchemaPackInstall).not.toHaveBeenCalled();
    const [query] = client.getQueryCache().findAll({ queryKey: ReactQueryKeys.schemaPackPlan() });
    expect(query.isStale()).toBe(true);
  });

  it('plans a new base without a base id', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useInstallPlan(ro, undefined, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.planSchemaPackInstall).toHaveBeenCalledWith(ro);
  });
});

describe('useInstallSchemaPacks', () => {
  it('adds to a base through the base route and drops every cached plan', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(ReactQueryKeys.schemaPackPlan('{"old":true}'), plan);
    const { result } = renderHook(() => useInstallSchemaPacks(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        kind: 'existing',
        baseId: 'bseA',
        ro: { packs: ['people'], options },
      })
    );
    expect(api.addSchemaPacks).toHaveBeenCalledWith('bseA', { packs: ['people'], options });
    expect(api.installSchemaPacks).not.toHaveBeenCalled();
    expect(client.getQueryCache().findAll({ queryKey: ReactQueryKeys.schemaPackPlan() })).toEqual(
      []
    );
  });
});
