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
