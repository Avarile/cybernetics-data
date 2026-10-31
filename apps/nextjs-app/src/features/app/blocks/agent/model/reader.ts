/** What the reader says of the agent's summary (scope design §8.3). */
export type ISummaryState =
  /** The record is short: no summary. */
  | { status: 'none' }
  /** The agent is not enabled or not set up. */
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; error: string };

/** The summary's state from what is known of the record, the agent and the request. Pure. */
export function summaryState(p: {
  /** Over SUMMARY_MIN_CHARS. */
  long: boolean;
  /** The agent is enabled and set up. */
  ready: boolean;
  text?: string;
  error?: string;
}): ISummaryState {
  if (!p.long) return { status: 'none' };
  if (!p.ready) return { status: 'unavailable' };
  if (p.error) return { status: 'error', error: p.error };
  if (p.text) return { status: 'ready', text: p.text };
  return { status: 'loading' };
}
