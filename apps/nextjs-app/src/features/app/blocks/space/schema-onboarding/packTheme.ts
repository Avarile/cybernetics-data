import type { SchemaPackId } from '@teable/openapi';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Target, Users, Wallet } from 'lucide-react';

export interface IPackTheme {
  Icon: LucideIcon;
  /** Icon bubble. */
  bubble: string;
  /** Selected card. */
  selected: string;
  /** Small dot / chip accent. */
  dot: string;
  /** SVG node fill and stroke. */
  node: string;
  edge: string;
}

/**
 * One accent per pack, used on the card, the preview, the review tab and the ready card.
 * Tints are translucent so they sit on any theme background (the default theme here is dark-styled).
 */
export const PACK_THEME: Record<SchemaPackId, IPackTheme> = {
  progress: {
    Icon: Target,
    bubble: 'bg-sky-500/15 text-sky-500',
    selected: 'ring-2 ring-sky-500 bg-sky-500/10',
    dot: 'bg-sky-500',
    node: 'fill-sky-500 stroke-sky-600',
    edge: 'stroke-sky-400',
  },
  people: {
    Icon: Users,
    bubble: 'bg-violet-500/15 text-violet-500',
    selected: 'ring-2 ring-violet-500 bg-violet-500/10',
    dot: 'bg-violet-500',
    node: 'fill-violet-500 stroke-violet-600',
    edge: 'stroke-violet-400',
  },
  knowledge: {
    Icon: BookOpen,
    bubble: 'bg-emerald-500/15 text-emerald-500',
    selected: 'ring-2 ring-emerald-500 bg-emerald-500/10',
    dot: 'bg-emerald-500',
    node: 'fill-emerald-500 stroke-emerald-600',
    edge: 'stroke-emerald-400',
  },
  finance: {
    Icon: Wallet,
    bubble: 'bg-amber-500/15 text-amber-500',
    selected: 'ring-2 ring-amber-500 bg-amber-500/10',
    dot: 'bg-amber-500',
    node: 'fill-amber-500 stroke-amber-600',
    edge: 'stroke-amber-400',
  },
};

/** The table each pack opens on the Ready step. */
export const PACK_ENTRY_TABLE: Record<SchemaPackId, string> = {
  progress: 'tasks',
  people: 'contacts',
  knowledge: 'knowledges',
  finance: 'finance_Transactions',
};
