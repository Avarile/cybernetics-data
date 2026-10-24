import { renderHook } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createConnectionContext } from '../../../context/__tests__/createConnectionContext';
import { useCommentPatchListener } from './useCommentPatchListener';

type IReceiveHandler = () => void;

const createMockPresence = () => {
  const handlers = new Set<IReceiveHandler>();
  const presence = {
    // `subscribed` only flips when the server acks, so it stays true right after unsubscribe.
    subscribed: false,
    wantSubscribe: false,
    remotePresences: {},
    subscribe: vi.fn(() => {
      presence.wantSubscribe = true;
      presence.subscribed = true;
    }),
    unsubscribe: vi.fn(() => {
      presence.wantSubscribe = false;
    }),
    destroy: vi.fn(),
    on: vi.fn((_event: string, handler: IReceiveHandler) => handlers.add(handler)),
    removeListener: vi.fn((_event: string, handler: IReceiveHandler) => handlers.delete(handler)),
    listenerCount: vi.fn(() => handlers.size),
  };
  return { presence, handlers };
};

describe('useCommentPatchListener', () => {
  it('keeps listening after the callback changes', () => {
    const { presence, handlers } = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;

    const { rerender } = renderHook(({ cb }) => useCommentPatchListener('tbl1', 'rec1', cb), {
      wrapper: createConnectionContext({ connected: true, connection }),
      initialProps: { cb: vi.fn() },
    });
    rerender({ cb: vi.fn() });

    expect(handlers.size).toBe(1);
    expect(presence.subscribe).toHaveBeenCalledTimes(2);
  });

  it('attaches a listener for every consumer of the same channel', () => {
    const { presence, handlers } = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;
    const wrapper = createConnectionContext({ connected: true, connection });

    renderHook(() => useCommentPatchListener('tbl1', 'rec1', vi.fn()), { wrapper });
    renderHook(() => useCommentPatchListener('tbl1', 'rec1', vi.fn()), { wrapper });

    expect(handlers.size).toBe(2);
    expect(presence.subscribe).toHaveBeenCalledTimes(1);
  });
});
