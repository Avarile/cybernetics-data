/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createAppContext } from '../__tests__/createAppContext';
import { createConnectionContext } from '../__tests__/createConnectionContext';
import { useInstances } from './useInstances';

const createWrapper = (connection: Connection) => {
  const AppProvider = createAppContext();
  const ConnectionProvider = createConnectionContext({ connected: true, connection });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <AppProvider>
      <ConnectionProvider>{children}</ConnectionProvider>
    </AppProvider>
  );
};

const createMockQuery = (collection: string, queryParams: unknown) => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    collection,
    query: queryParams,
    results: [],
    ready: true,
    sent: true,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      (handlers[event] ??= []).push(cb);
    }),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    destroy: vi.fn((cb?: () => void) => cb?.()),
    emit: (event: string, ...args: any[]) => handlers[event]?.forEach((cb) => cb(...args)),
  };
};

// Mirrors sharedb 5.2.2: `subscribed` only flips once the server acks, `wantSubscribe` immediately
const createMockDoc = (id: string) => ({
  id,
  data: { id },
  on: vi.fn(),
  removeListener: vi.fn(),
  listenerCount: vi.fn(() => 0),
  destroy: vi.fn(),
});

const createMockPresence = () => {
  const listeners = new Set<any>();
  const presence = {
    wantSubscribe: false,
    subscribed: false,
    subscribe: vi.fn(() => {
      presence.wantSubscribe = true;
    }),
    unsubscribe: vi.fn(() => {
      presence.wantSubscribe = false;
    }),
    destroy: vi.fn(),
    addListener: vi.fn((_event: string, cb: unknown) => listeners.add(cb)),
    removeListener: vi.fn((_event: string, cb: unknown) => listeners.delete(cb)),
    listenerCount: vi.fn(() => listeners.size),
    emitReceive: (batch: unknown) => listeners.forEach((cb) => cb('presence-id', batch)),
  };
  return presence;
};

const createMockConnection = () => {
  const presence = createMockPresence();
  const queries: ReturnType<typeof createMockQuery>[] = [];
  const connection = {
    createSubscribeQuery: vi.fn((collection: string, queryParams: unknown) => {
      const query = createMockQuery(collection, queryParams);
      queries.push(query);
      return query;
    }),
    getPresence: vi.fn(() => presence),
  };
  return { connection: connection as unknown as Connection, presence, queries };
};

const factory = (data: any) => data;

describe('useInstances subscriptions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-subscribes the action presence when the effect re-runs before the unsubscribe is acked', () => {
    const { connection, presence } = createMockConnection();
    const { rerender } = renderHook(
      ({ queryParams }) =>
        useInstances({ collection: 'rec_tblPresenceRerun', factory, queryParams }),
      { wrapper: createWrapper(connection), initialProps: { queryParams: { viewId: 'a' } } }
    );
    // Server acked the first subscribe
    presence.subscribed = true;
    expect(presence.subscribe).toHaveBeenCalledTimes(1);

    rerender({ queryParams: { viewId: 'b' } });

    expect(presence.unsubscribe).toHaveBeenCalledTimes(1);
    expect(presence.subscribe).toHaveBeenCalledTimes(2);
    expect(presence.wantSubscribe).toBe(true);
  });

  it('handles query errors and does not reuse the failed query for later mounts', () => {
    const { connection, queries } = createMockConnection();
    const props = { collection: 'fld_tblQueryError', factory, queryParams: { id: 1 } };
    const wrapper = createWrapper(connection);

    renderHook(() => useInstances(props), { wrapper });
    expect(queries).toHaveLength(1);
    expect(() => queries[0].emit('error', new Error('forbidden'))).not.toThrow();

    renderHook(() => useInstances(props), { wrapper });
    expect(queries).toHaveLength(2);
  });

  it('does not share cached queries across connections', () => {
    const first = createMockConnection();
    const second = createMockConnection();
    const props = { collection: 'fld_tblConnectionScope', factory, queryParams: { id: 1 } };

    renderHook(() => useInstances(props), { wrapper: createWrapper(first.connection) });
    renderHook(() => useInstances(props), { wrapper: createWrapper(second.connection) });

    expect(first.queries).toHaveLength(1);
    expect(second.queries).toHaveLength(1);
  });

  it('keeps the shared query alive until its last holder releases it', () => {
    const { connection, queries } = createMockConnection();
    const props = { collection: 'fld_tblRefCount', factory, queryParams: { id: 1 } };
    const wrapper = createWrapper(connection);

    const a = renderHook(() => useInstances(props), { wrapper });
    const b = renderHook(() => useInstances(props), { wrapper });
    expect(queries).toHaveLength(1);

    a.unmount();
    expect(queries[0].destroy).not.toHaveBeenCalled();
    b.unmount();
    expect(queries[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps server diff indexes aligned after a projected record delete', () => {
    const { connection, presence, queries } = createMockConnection();
    const collection = 'rec_tblDiffAlign';
    const docs = ['rec1', 'rec2', 'rec3'].map(createMockDoc);
    vi.mocked(connection.createSubscribeQuery).mockImplementationOnce(
      (queryCollection: string, queryParams: unknown) => {
        const query = { ...createMockQuery(queryCollection, queryParams), results: [...docs] };
        queries.push(query as any);
        return query as any;
      }
    );
    const { result } = renderHook(
      () => useInstances({ collection, factory, queryParams: { viewId: 'viwDiff' } }),
      { wrapper: createWrapper(connection) }
    );
    const query = queries[0];
    const ids = () => result.current.instances.map((instance: any) => instance.id);
    expect(ids()).toEqual(['rec1', 'rec2', 'rec3']);

    act(() =>
      presence.emitReceive([
        {
          actionKey: 'deleteRecord',
          payload: { tableId: 'tblDiffAlign', recordIds: ['rec2'], skipRealtime: true },
        },
      ])
    );
    expect(ids()).toEqual(['rec1', 'rec3']);
    // The server still has rec2 in its result set, so the client must keep it there too
    expect(query.results.map((doc: any) => doc.id)).toEqual(['rec1', 'rec2', 'rec3']);

    // Simulate sharedb applying the server diffs: remove rec2 at 1, then insert rec4 at 1
    act(() => {
      const removed = (query.results as any[]).splice(1, 1);
      query.emit('remove', removed, 1);
    });
    expect(ids()).toEqual(['rec1', 'rec3']);

    act(() => {
      const inserted = [createMockDoc('rec4')];
      (query.results as any[]).splice(1, 0, ...inserted);
      query.emit('insert', inserted, 1);
    });
    expect(ids()).toEqual(['rec1', 'rec4', 'rec3']);
  });
});
