/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getTableButtonClickChannel } from '@teable/core';
import { buttonClick as buttonClickApi } from '@teable/openapi';
import { act, renderHook } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createAppContext } from '../context/__tests__/createAppContext';
import { createConnectionContext } from '../context/__tests__/createConnectionContext';
import { useButtonClickStatus } from './use-button-click-status';

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => 'toast-id'),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@teable/ui-lib', () => ({
  sonner: { toast },
  useConfirm: () => ({ confirm: vi.fn() }),
}));

vi.mock('@teable/openapi', async () => {
  const actual = await vi.importActual('@teable/openapi');
  return { ...actual, buttonClick: vi.fn(), shareViewButtonClick: vi.fn() };
});

const tableId = 'tblButton';
const channel = getTableButtonClickChannel(tableId);

const createMockPresence = () => {
  const listeners = new Set<() => void>();
  const presence = {
    wantSubscribe: false,
    subscribed: false,
    remotePresences: {} as Record<string, unknown>,
    subscribe: vi.fn(() => {
      presence.wantSubscribe = true;
    }),
    unsubscribe: vi.fn(() => {
      presence.wantSubscribe = false;
    }),
    destroy: vi.fn(),
    on: vi.fn((_event: string, cb: () => void) => listeners.add(cb)),
    removeListener: vi.fn((_event: string, cb: () => void) => listeners.delete(cb)),
    listenerCount: vi.fn(() => listeners.size),
    receive: (status: unknown) => {
      presence.remotePresences = { [channel]: status };
      listeners.forEach((cb) => cb());
    },
  };
  return presence;
};

const createWrapper = (connection: Connection) => {
  const providers = {
    App: createAppContext(),
    Connection: createConnectionContext({ connected: true, connection }),
  };
  const queryClient = new QueryClient();
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <providers.App>
      <providers.Connection>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </providers.Connection>
    </providers.App>
  );
};

const ro = { tableId, recordId: 'recA', fieldId: 'fldButton', name: 'Run' };

describe('useButtonClickStatus', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the failure when the socket result arrives before the http response', async () => {
    const presence = createMockPresence();
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;
    let resolveHttp: ((value: unknown) => void) | undefined;
    vi.mocked(buttonClickApi).mockReturnValue(
      new Promise((resolve) => {
        resolveHttp = resolve;
      }) as any
    );

    const { result } = renderHook(() => useButtonClickStatus(tableId), {
      wrapper: createWrapper(connection),
    });

    let clickPromise: Promise<unknown> | undefined;
    act(() => {
      clickPromise = result.current.buttonClick(ro);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      presence.receive({ ...ro, runId: 'run1', loading: false, errorMessage: 'boom' });
    });
    await act(async () => {
      resolveHttp?.({ data: { runId: 'run1' } });
      await clickPromise;
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('listens for results even when another instance already holds the presence', () => {
    const presence = createMockPresence();
    presence.wantSubscribe = true;
    presence.subscribed = true;
    const connection = { getPresence: vi.fn(() => presence) } as unknown as Connection;

    renderHook(() => useButtonClickStatus(tableId), { wrapper: createWrapper(connection) });

    expect(presence.subscribe).not.toHaveBeenCalled();
    expect(presence.on).toHaveBeenCalledWith('receive', expect.any(Function));
  });
});
