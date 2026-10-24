import type { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useConnection } from './useConnection';

const mock = vi.hoisted(() => ({ connections: [] as unknown[] }));

vi.mock('sharedb/lib/client', async () => {
  const { EventEmitter: Emitter } = (await vi.importActual('events')) as {
    EventEmitter: typeof EventEmitter;
  };
  class Connection extends Emitter {
    canSend = true;
    ping = vi.fn();
    close = vi.fn();
    bindToSocket = vi.fn();
    constructor() {
      super();
      mock.connections.push(this);
    }
  }
  return { Connection };
});

vi.mock('../../utils/reconnectingSockJS', () => ({
  ReconnectingSockJS: class {
    reconnect = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock('./useConnectionAutoManage', () => ({
  isConnected: () => true,
  useConnectionAutoManage: () => undefined,
}));

type IMockConnection = EventEmitter & { canSend: boolean; ping: ReturnType<typeof vi.fn> };

describe('useConnection ping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.connections = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a single ping interval and stops it when the server stops the connection', () => {
    renderHook(() => useConnection('http://localhost/socket'));
    const connection = mock.connections.at(-1) as IMockConnection;

    act(() => {
      connection.emit('connected');
      connection.emit('connected');
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(connection.ping).toHaveBeenCalledTimes(1);

    act(() => {
      connection.canSend = false;
      connection.emit('stopped');
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(connection.ping).toHaveBeenCalledTimes(1);
  });
});
