import type { ISearchTone } from '@teable/openapi';
import { money } from './format';
import type { IGraph } from './graph/types';
import type { ITableInfo } from './overview/presentation';

/** The order of a mix bar's segments, settled first (the cockpit's stack). */
const STACK: ISearchTone[] = ['ink', 'route', 'target', 'caution', 'dim', 'faint'];

/** One row of the vectors panel: a branch (or a searched table) and its mix. */
export interface IVector {
  id: string;
  label: string;
  /** A key shown before the label, when it differs from it. */
  short?: string;
  /** The right-hand figure: share done, money moved, or nothing. */
  right: string;
  stack: [ISearchTone, number][];
  facts: { text: string; tone?: ISearchTone }[];
}

const stackOf = (mix: Partial<Record<ISearchTone, number>>) =>
  STACK.filter((t) => mix[t]).map((t) => [t, mix[t]!] as [ISearchTone, number]);

/**
 * The branches of a dataset as the cockpit's vectors (its panels.ts): count and the meaningful
 * tones as facts, the share done or the money moved on the right, a stacked mix bar.
 */
export function overviewVectors(
  g: IGraph,
  info: Pick<ITableInfo, 'toneNames' | 'unit' | 'right'>
): IVector[] {
  const names = info.toneNames;
  return g.branches
    .filter((b) => b.count)
    .map((b) => {
      const live = b.count - b.mix.faint;
      const node = g.byId.get(b.id);
      const short = node?.short && node.short !== b.label.toUpperCase() ? node.short : undefined;
      let right = '';
      if (info.right === 'pct' && live) right = `${Math.round((b.mix.ink / live) * 100)}%`;
      if (info.right === 'sum' && b.sum) right = money(b.sum);
      const toned = (['route', 'target'] as const).filter((t) => b.mix[t] && names[t]);
      return {
        id: b.id,
        label: b.label,
        ...(short ? { short } : {}),
        right,
        stack: stackOf(b.mix),
        facts: [
          { text: `${b.count} ${info.unit}` },
          ...toned.map((t) => ({ text: `${b.mix[t]} ${names[t]}`, tone: t })),
          ...(b.alert
            ? [{ text: `${b.alert} ${names.caution ?? 'ALERT'}`, tone: 'caution' as const }]
            : []),
        ],
      };
    });
}
