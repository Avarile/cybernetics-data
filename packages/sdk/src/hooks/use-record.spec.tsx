/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook } from '@testing-library/react';
import type { Connection } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createConnectionContext } from '../context/__tests__/createConnectionContext';
import { useRecord } from './use-record';

vi.mock('./use-table-id', () => ({ useTableId: () => 'tblTest' }));
vi.mock('./use-fields', () => ({ useFields: () => [{ id: 'fldName' }] }));
vi.mock('../model/record', () => ({
  createRecordInstance: (data: any, doc?: any) => ({ ...data, doc }),
  recordInstanceFieldMap: (instance: any) => instance,
}));

const createMockDoc = (id: string) => {
  const opBatchListeners = new Set<unknown>();
  const doc = {
    id,
    data: { id, fields: { fldName: id } },
    fetchCallback: undefined as undefined | ((err?: unknown) => void),
    subscribeCallback: undefined as undefined | ((err?: unknown) => void),
    fetch: vi.fn((cb: (err?: unknown) => void) => {
      doc.fetchCallback = cb;
    }),
    subscribe: vi.fn((cb: (err?: unknown) => void) => {
      doc.subscribeCallback = cb;
    }),
    on: vi.fn((_event: string, cb: unknown) => opBatchListeners.add(cb)),
    removeListener: vi.fn((_event: string, cb: unknown) => opBatchListeners.delete(cb)),
    listenerCount: vi.fn(() => opBatchListeners.size),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
  };
  return doc;
};

describe('useRecord', () => {
  it('ignores late fetch and subscribe callbacks from the previous record', () => {
    const docs: Record<string, ReturnType<typeof createMockDoc>> = {};
    const connection = {
      get: vi.fn((_collection: string, id: string) => (docs[id] ??= createMockDoc(id))),
    } as unknown as Connection;

    const { result, rerender } = renderHook(({ recordId }) => useRecord(recordId), {
      wrapper: createConnectionContext({ connected: true, connection }),
      initialProps: { recordId: 'recA' },
    });

    act(() => docs.recA.fetchCallback?.());
    expect(result.current?.id).toBe('recA');

    rerender({ recordId: 'recB' });
    // A's data must not be shown under B while B is loading
    expect(result.current).toBeUndefined();

    act(() => {
      docs.recA.fetchCallback?.();
      docs.recA.subscribeCallback?.();
    });
    expect(result.current).toBeUndefined();
    expect(docs.recA.on).not.toHaveBeenCalled();

    act(() => docs.recB.fetchCallback?.());
    expect(result.current?.id).toBe('recB');
  });
});
