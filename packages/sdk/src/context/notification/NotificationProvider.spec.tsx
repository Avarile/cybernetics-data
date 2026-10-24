import { render } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createConnectionContext } from '../__tests__/createConnectionContext';
import { NotificationProvider } from './NotificationProvider';

const mockUser = vi.hoisted(() => ({ current: { id: 'usrTest' } as { id?: string } }));

vi.mock('../../hooks', () => ({ useSession: () => ({ user: mockUser.current }) }));

const createMockPresence = () => {
  const presence = {
    wantSubscribe: false,
    subscribe: vi.fn((cb?: (err?: unknown) => void) => {
      presence.wantSubscribe = true;
      cb?.(new Error('subscribe failed'));
    }),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return presence;
};

describe('NotificationProvider', () => {
  it('subscribes the fetched presence once and logs subscribe errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const presence = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;
    const ConnectionProvider = createConnectionContext({ connected: true, connection });
    mockUser.current = { id: 'usrTest' };

    render(
      <ConnectionProvider>
        <NotificationProvider>child</NotificationProvider>
      </ConnectionProvider>
    );

    expect(presence.subscribe).toHaveBeenCalledTimes(1);
    expect(presence.on).toHaveBeenCalledWith('receive', expect.any(Function));
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Subscribe error'),
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('does not subscribe a channel before the session user is loaded', () => {
    const presence = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;
    const ConnectionProvider = createConnectionContext({ connected: true, connection });
    mockUser.current = {};

    render(
      <ConnectionProvider>
        <NotificationProvider>child</NotificationProvider>
      </ConnectionProvider>
    );

    expect(connection.getPresence).not.toHaveBeenCalled();
  });
});
