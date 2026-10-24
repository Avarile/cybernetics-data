import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { PluginBridge } from '../bridge';
import { usePluginBridge } from './use-bridge';

const bridgeMock = vi.hoisted(() => ({ instances: [] as Array<{ destroy: () => void }> }));

vi.mock('../bridge', () => ({
  PluginBridge: vi.fn(function (this: Record<string, unknown>) {
    const bridge = { id: bridgeMock.instances.length };
    this.init = vi.fn(() => Promise.resolve(bridge));
    this.destroy = vi.fn();
    bridgeMock.instances.push(this as unknown as { destroy: () => void });
  }),
}));

describe('usePluginBridge', () => {
  beforeEach(() => {
    bridgeMock.instances = [];
    vi.mocked(PluginBridge).mockClear();
  });

  it('shares one connection between consumers and recreates it after the last unmount', async () => {
    const first = renderHook(() => usePluginBridge());
    const second = renderHook(() => usePluginBridge());
    await act(async () => {
      await Promise.resolve();
    });

    expect(PluginBridge).toHaveBeenCalledTimes(1);
    expect(first.result.current).toBeDefined();
    expect(second.result.current).toBe(first.result.current);

    first.unmount();
    expect(bridgeMock.instances[0].destroy).not.toHaveBeenCalled();
    second.unmount();
    expect(bridgeMock.instances[0].destroy).toHaveBeenCalledTimes(1);

    const third = renderHook(() => usePluginBridge());
    await act(async () => {
      await Promise.resolve();
    });
    expect(PluginBridge).toHaveBeenCalledTimes(2);
    expect(third.result.current).toEqual({ id: 1 });
  });
});
