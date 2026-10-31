import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SUMMARY_MIN_CHARS } from '@teable/openapi';
import { useEffect, useRef } from 'react';
import { cockpitQueryKeys, fetchRecord, fetchSummary } from '../data/cockpit-api';
import { summaryState } from '../model/reader';
import { useSearchStore } from '../state/search-store';
import { useAgentStatus } from './useAgentData';

const messageOf = (error: unknown) => (error as Error)?.message || 'FAILED';

/**
 * The record in the reader (scope design §8): its Markdown, and over 500 characters the agent's
 * summary, which is spoken once per opening when voice is on and goes to the log. Closing it
 * stops the voice and drops a summary still on its way.
 */
export function useRecordReader(voice: {
  say: (id: string, text: string) => void;
  stopSpeech: () => void;
}) {
  const queryClient = useQueryClient();
  const open = useSearchStore((s) => s.record);
  const { data: agent } = useAgentStatus();
  const ready = Boolean(agent?.enabled && agent.status === 'ok');
  const record = useQuery({
    queryKey: open
      ? cockpitQueryKeys.record(open.tableId, open.recordId)
      : ['agent', 'cockpit', 'record', 'none'],
    queryFn: () => fetchRecord(open!.tableId, open!.recordId),
    enabled: Boolean(open),
    staleTime: 0,
    retry: false,
  });
  const vo = open && record.data?.recordId === open.recordId ? record.data : undefined;
  const long = Boolean(vo && vo.chars > SUMMARY_MIN_CHARS);
  const summaryKey = vo
    ? cockpitQueryKeys.summary(vo.recordId, vo.version)
    : (['agent', 'cockpit', 'summary', 'none'] as const);
  const summary = useQuery({
    queryKey: summaryKey,
    queryFn: ({ signal }) => fetchSummary(vo!.tableId, vo!.recordId, signal),
    enabled: long && ready,
    staleTime: Infinity,
    retry: false,
  });

  // once per opening: said when voice is on, and logged
  const said = useRef<string>();
  const text = summary.data?.summary;
  const { say } = voice;
  useEffect(() => {
    if (!open || !vo || !text) return;
    const id = `summary:${vo.recordId}:${vo.version}:${open.opened}`;
    if (said.current === id) return;
    said.current = id;
    say(id, text);
    useSearchStore.getState().addLog('summary', `${vo.title}: ${text}`);
  }, [open, vo, text, say]);

  const close = () => {
    voice.stopSpeech();
    void queryClient.cancelQueries({ queryKey: summaryKey });
    useSearchStore.getState().closeRecord();
  };

  return {
    open,
    record: vo,
    loading: Boolean(open) && record.isLoading,
    error: record.error ? messageOf(record.error) : undefined,
    summary: summaryState({
      long,
      ready,
      text,
      error: summary.error ? messageOf(summary.error) : undefined,
    }),
    close,
  };
}
