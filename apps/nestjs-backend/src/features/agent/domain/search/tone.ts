import type { ISearchTone } from './search.types';

/**
 * State words → tone, so any status-like select colours the same way in every table (ported from
 * the ai-cockpit's graph.ts). Settled = ink, active = route, next = target, caution, backlog = dim,
 * cancelled or archived = faint.
 */
export function toneOf(value: unknown): ISearchTone {
  const s = String(value ?? '')
    .toLowerCase()
    .trim();
  if (!s) return 'none';
  if (/cancel|archiv|drop|reject|void|abandon/.test(s)) return 'faint';
  if (/hold|block|stuck|risk|overdue|late/.test(s)) return 'caution';
  if (/finish|final|done|complete|closed|paid|deliver|resolved|valid|landed|shipped/.test(s))
    return 'ink';
  if (/todo|to do|ready|next|plan|prepar|queue|unstarted|armed|scheduled/.test(s)) return 'target';
  if (/progress|doing|active|start|initiat|review|test|running|working|engaged/.test(s))
    return 'route';
  if (/backlog|idea|later|someday|draft|inbox/.test(s)) return 'dim';
  return 'none';
}

/** 0-4 from a priority word: urgent largest. */
export function sizeOfPriority(value: unknown): number {
  const s = String(value ?? '').toLowerCase();
  if (/urgent|critical|highest/.test(s)) return 4;
  if (/high|important/.test(s)) return 3;
  if (/priorit|medium/.test(s)) return 2;
  if (/normal|low|wait/.test(s)) return 1;
  return 0;
}

/** 0-4 from an amount, on a log scale. */
export const sizeOfAmount = (n: unknown): number =>
  Math.max(0, Math.min(4, Math.log10(Math.abs(Number(n) || 0) + 1) * 1.25));
