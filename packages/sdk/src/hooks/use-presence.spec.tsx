/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createConnectionContext } from '../context/__tests__/createConnectionContext';
import { usePresence } from './use-presence';

const createMockPresence = () => {
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
    listenerCount: vi.fn(() => 0),
  };
  return presence;
};

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('still unsubscribes the previous channel after switching channels', () => {
    const presences: Record<string, ReturnType<typeof createMockPresence>> = {};
    const connection = {
      getPresence: vi.fn((channel: string) => (presences[channel] ??= createMockPresence())),
    } as unknown as Connection;

    const { rerender } = renderHook(({ channel }) => usePresence(channel), {
      wrapper: createConnectionContext({ connected: true, connection }),
      initialProps: { channel: 'channel-a' },
    });
    rerender({ channel: 'channel-b' });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(presences['channel-a'].unsubscribe).toHaveBeenCalledTimes(1);
    expect(presences['channel-a'].destroy).toHaveBeenCalledTimes(1);
    expect(presences['channel-b'].unsubscribe).not.toHaveBeenCalled();
  });

  it('keeps the presence subscribed when the same channel remounts within the delay', () => {
    const presence = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;
    const wrapper = createConnectionContext({ connected: true, connection });

    const first = renderHook(() => usePresence('channel-a'), { wrapper });
    first.unmount();
    renderHook(() => usePresence('channel-a'), { wrapper });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(presence.unsubscribe).not.toHaveBeenCalled();
    expect(presence.subscribe).toHaveBeenCalledTimes(1);
  });
});
