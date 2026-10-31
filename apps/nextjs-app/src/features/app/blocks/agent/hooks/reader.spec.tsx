import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@/test-utils';
import { useSearchStore } from '../state/search-store';
import { useRecordReader } from './useRecordReader';

const status = vi.hoisted(() => ({ enabled: true, status: 'ok' }));
const record = vi.hoisted(() => ({ chars: 800 }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAgentStatus: vi.fn(async () => ({ ...status, tables: {}, models: [], warnings: [] })),
  getCockpitRecord: vi.fn(async (tableId: string, recordId: string) => ({
    tableId,
    tableName: 'knowledges',
    baseId: 'bse1',
    recordId,
    title: 'Deploy K3s',
    markdown: '# Deploy K3s\n',
    chars: record.chars,
    version: '2026-10-30T14:02:00.000Z',
    masked: [],
  })),
  summarizeCockpitRecord: vi.fn(async () => ({
    summary: 'Deploy steps for K3s.',
    model: 'openai/small',
    cached: false,
  })),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('the record reader (scope design §8)', () => {
  const voice = { say: vi.fn(), stopSpeech: vi.fn() };
  beforeEach(() => {
    status.enabled = true;
    record.chars = 800;
    voice.say.mockClear();
    voice.stopSpeech.mockClear();
    useSearchStore.setState({ record: undefined, log: [] });
  });
  afterEach(cleanup);

  it('summarises a long record, says it once per opening and logs it', async () => {
    const { result } = renderHook(() => useRecordReader(voice), { wrapper });
    act(() => useSearchStore.getState().openRecord('recK', 'tblKnow'));
    await waitFor(() =>
      expect(result.current.summary).toEqual({ status: 'ready', text: 'Deploy steps for K3s.' })
    );
    expect(voice.say).toHaveBeenCalledTimes(1);
    expect(voice.say.mock.calls[0][0]).toMatch(/^summary:recK:2026-10-30T14:02:00.000Z:\d+$/);
    expect(useSearchStore.getState().log.map((l) => l.text)).toEqual([
      'Deploy K3s: Deploy steps for K3s.',
    ]);
    act(() => result.current.close());
    expect(voice.stopSpeech).toHaveBeenCalled();
    expect(useSearchStore.getState().record).toBeUndefined();
  });

  it('does not summarise a short record, and says it needs the agent when it is off', async () => {
    record.chars = 120;
    const { result } = renderHook(() => useRecordReader(voice), { wrapper });
    act(() => useSearchStore.getState().openRecord('recShort', 'tblKnow'));
    await waitFor(() => expect(result.current.record?.chars).toBe(120));
    expect(result.current.summary).toEqual({ status: 'none' });
    expect(voice.say).not.toHaveBeenCalled();
    cleanup();

    record.chars = 900;
    status.enabled = false;
    const off = renderHook(() => useRecordReader(voice), { wrapper });
    act(() => useSearchStore.getState().openRecord('recLong', 'tblKnow'));
    await waitFor(() => expect(off.result.current.summary).toEqual({ status: 'unavailable' }));
  });
});
