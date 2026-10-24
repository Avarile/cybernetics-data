/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getTableCommentChannel } from '@teable/core';
import { CommentPatchType, getCommentCount } from '@teable/openapi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useCommentCountMap } from './use-comment-count-map';

const mock = vi.hoisted(() => ({ presence: undefined as any }));

vi.mock('@teable/openapi', async () => {
  const actual = await vi.importActual('@teable/openapi');
  return { ...actual, getCommentCount: vi.fn() };
});
vi.mock('./use-table-id', () => ({ useTableId: () => 'tblComment' }));
vi.mock('./use-view-id', () => ({ useViewId: () => 'viwComment' }));
vi.mock('./use-view', () => ({ useView: () => undefined }));
vi.mock('./use-search', () => ({ useSearch: () => ({ searchQuery: undefined }) }));
vi.mock('./use-connection', () => ({
  useConnection: () => ({ connection: { getPresence: () => mock.presence }, connected: true }),
}));

const createMockPresence = () => {
  const listeners = new Set<() => void>();
  return {
    remotePresences: {} as Record<string, unknown>,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((_event: string, cb: () => void) => listeners.add(cb)),
    removeListener: vi.fn((_event: string, cb: () => void) => listeners.delete(cb)),
    listenerCount: vi.fn(() => listeners.size),
    receive(channel: string, value: unknown) {
      this.remotePresences = { [channel]: value };
      listeners.forEach((cb) => cb());
    },
  };
};

describe('useCommentCountMap', () => {
  it('updates counts without mutating the react-query cache', async () => {
    mock.presence = createMockPresence();
    vi.mocked(getCommentCount).mockResolvedValue({
      data: [{ recordId: 'rec1', count: 1 }],
    } as any);
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useCommentCountMap(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current).toEqual({ rec1: 1 }));
    const cached = queryClient.getQueryCache().getAll()[0].state.data;
    const channel = getTableCommentChannel('tblComment');

    act(() => {
      mock.presence.receive(channel, {
        type: CommentPatchType.CreateComment,
        data: { recordId: 'rec1' },
      });
    });
    expect(result.current).toEqual({ rec1: 2 });
    expect(cached).toEqual([{ recordId: 'rec1', count: 1 }]);

    act(() => {
      mock.presence.receive(channel, {
        type: CommentPatchType.DeleteComment,
        data: { recordId: 'rec1' },
      });
      mock.presence.receive(channel, {
        type: CommentPatchType.DeleteComment,
        data: { recordId: 'rec1' },
      });
    });
    expect(result.current).toEqual({});
    expect(cached).toEqual([{ recordId: 'rec1', count: 1 }]);
  });
});
