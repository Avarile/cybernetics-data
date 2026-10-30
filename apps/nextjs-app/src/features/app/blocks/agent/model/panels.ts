import type { IAgentOverviewVo, ISearchTone } from '@teable/openapi';
import { money } from './format';
import type { IGraph } from './graph/types';
import { laneMix } from './metrics';
import type { IOverviewDatasetInfo } from './overview/datasets';
import { lanesOf, sourceText, type IBoard } from './search-board';

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

/** One row of the flight log. */
export interface IFeedRow {
  id: string;
  /** When (ms). */
  t: number;
  verb: string;
  tone: ISearchTone;
  key: string;
  text: string;
}

const stackOf = (mix: Partial<Record<ISearchTone, number>>) =>
  STACK.filter((t) => mix[t]).map((t) => [t, mix[t]!] as [ISearchTone, number]);

/**
 * The branches of a dataset as the cockpit's vectors (its panels.ts): count and the meaningful
 * tones as facts, the share done or the money moved on the right, a stacked mix bar.
 */
export function overviewVectors(g: IGraph, info: IOverviewDatasetInfo): IVector[] {
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

/** The dataset's dated records, newest first: the cockpit's recent feed. */
export function overviewFeed(vo: IAgentOverviewVo, info: IOverviewDatasetInfo): IFeedRow[] {
  return vo.nodes
    .filter((n) => n.recordId && n.date && n.kind !== 'hub')
    .map((n) => ({
      id: n.id,
      t: Date.parse(n.date!),
      verb: info.verbs[n.tone] ?? (n.state ?? 'RECORD').split(/\s/)[0].toUpperCase().slice(0, 10),
      tone: n.tone === 'none' ? ('ink' as const) : n.tone,
      key: n.short ?? '',
      text: n.amount ? `${n.label} · ${money(Math.abs(n.amount))}` : n.label,
    }))
    .filter((r) => !Number.isNaN(r.t))
    .sort((a, b) => b.t - a.t)
    .slice(0, 28);
}

/** The tables a search went through, as vectors: what each found and its mix. */
export function searchVectors(board: IBoard): IVector[] {
  return lanesOf(board).map((lane) => {
    const cards = board.cards.filter((c) => lane.stepIds.includes(c.stepId));
    const mix = Object.fromEntries(laneMix(lane, cards)) as Partial<Record<ISearchTone, number>>;
    return {
      id: lane.tableId,
      label: lane.table.toUpperCase(),
      right: lane.found > lane.shown ? `${lane.shown}/${lane.found}` : String(lane.found),
      stack: stackOf(mix),
      facts: [{ text: lane.purpose }, { text: lane.status.toUpperCase().replace('_', ' ') }],
    };
  });
}

const verbOf: Record<string, string> = {
  search: 'SEARCH',
  records: 'PICKED',
  filter: 'FILTER',
  follow: 'FOLLOW',
  reverse: 'REVERSE',
};

/** A search's steps as the flight log: when each ran, how it reached its table, what it found. */
export function searchFeed(board: IBoard): IFeedRow[] {
  return (board.plan?.steps ?? []).map((step) => {
    const st = board.states[step.id];
    const time = board.times[step.id];
    const status = st?.status ?? 'pending';
    const tone: ISearchTone =
      status === 'failed' || status === 'needs_choice'
        ? 'caution'
        : status === 'running'
          ? 'route'
          : status === 'pending'
            ? 'dim'
            : 'ink';
    const found = st && status !== 'pending' ? ` ${st.found}` : '';
    return {
      id: step.id,
      t: time?.finished ?? time?.started ?? 0,
      verb: verbOf[step.source.kind],
      tone,
      key: step.table.name,
      text: `${sourceText(board.plan, step.id)} → ${status}${found}${st?.error ? ` · ${st.error}` : ''}`,
    };
  });
}
