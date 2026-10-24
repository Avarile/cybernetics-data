import { connectToParent } from 'penpal';
import { vi } from 'vitest';
import { PluginBridge } from './bridge';

vi.mock('penpal', () => ({
  connectToParent: vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() })),
}));

describe('PluginBridge', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('only accepts its own origin as the parent by default', () => {
    new PluginBridge();
    expect(vi.mocked(connectToParent).mock.calls[0][0]).toMatchObject({
      parentOrigin: window.location.origin,
    });
  });

  it('accepts an explicit parent origin', () => {
    new PluginBridge({ parentOrigin: 'https://host.example.com' });
    expect(vi.mocked(connectToParent).mock.calls[0][0]).toMatchObject({
      parentOrigin: 'https://host.example.com',
    });
  });
});
