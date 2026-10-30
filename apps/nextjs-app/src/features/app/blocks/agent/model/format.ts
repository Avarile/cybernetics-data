import type { IAgentThreadVo } from '@teable/openapi';

/** Tokens and cost of a thread, for the thread menu. */
export const formatUsage = (t: Pick<IAgentThreadVo, 'tokensIn' | 'tokensOut' | 'costUsd'>) => {
  const tokens = (t.tokensIn ?? 0) + (t.tokensOut ?? 0);
  const k = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  return t.costUsd ? `${k} tok · $${t.costUsd.toFixed(4)}` : `${k} tok`;
};

/** Rows in a grid selection's row ranges ([start, end], inclusive). */
export const countRows = (rows: [number, number][] | null | undefined) =>
  (rows ?? []).reduce((sum, [start, end]) => sum + (end - start + 1), 0);

/** An amount as the readouts show money: whole units, grouped, no currency symbol. */
export const money = (n: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

/**
 * When, as the flight log shows it (UTC): the time today, the month and day before today, and
 * dashes for a step that has not run yet.
 */
export const logTime = (ms: number, now = Date.now()) => {
  if (!ms) return '--:--';
  const d = new Date(ms);
  const n = new Date(now);
  const p = (x: number) => String(x).padStart(2, '0');
  const today =
    d.getUTCFullYear() === n.getUTCFullYear() &&
    d.getUTCMonth() === n.getUTCMonth() &&
    d.getUTCDate() === n.getUTCDate();
  return today
    ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
    : `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
