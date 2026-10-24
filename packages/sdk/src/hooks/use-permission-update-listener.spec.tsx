import { renderHook } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createConnectionContext } from '../context/__tests__/createConnectionContext';
import { usePermissionUpdateListener } from './use-permission-update-listener';

const createMockPresence = () => {
  const listeners = new Set<(id: string, data: string) => void>();
  const presence = {
    wantSubscribe: false,
    subscribe: vi.fn((cb?: (err?: unknown) => void) => {
      presence.wantSubscribe = true;
      cb?.(new Error('subscribe failed'));
    }),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((_event: string, cb: (id: string, data: string) => void) => listeners.add(cb)),
    removeListener: vi.fn((_event: string, cb: (id: string, data: string) => void) =>
      listeners.delete(cb)
    ),
    listenerCount: vi.fn(() => listeners.size),
    emitReceive: (data: string) => listeners.forEach((cb) => cb('id', data)),
  };
  return presence;
};

describe('usePermissionUpdateListener', () => {
  it('subscribes the fetched presence once, logs subscribe errors and forwards updates', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const presence = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;
    const trigger = vi.fn();

    renderHook(() => usePermissionUpdateListener('bseTest', trigger), {
      wrapper: createConnectionContext({ connected: true, connection }),
    });

    expect(presence.subscribe).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Subscribe error'),
      expect.any(Error)
    );
    presence.emitReceive('usrOperator');
    expect(trigger).toHaveBeenCalledWith('usrOperator');
    consoleError.mockRestore();
  });
});
