import { LocalStorageKeys } from '@cybernetics/sdk/config';
import type { ICockpitTable } from '@teable/openapi';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currentDataset } from '../model/overview/cycle';
import { forceFirst } from '../model/search-results';
import { useCockpitStore } from './cockpit-store';

/** The search on the stage: its text and the table it ran on (scope design §7.2). */
export interface IActiveQuery {
  text: string;
  tableId: string;
  /** Enter on the same text runs it again. */
  nonce: number;
}

export type IAskLogKind = 'base' | 'table' | 'query' | 'summary' | 'default' | 'error';

/** One line of the ask panel's log (scope design §6.6). */
export interface IAskLogEntry {
  id: number;
  /** When (ms). */
  t: number;
  kind: IAskLogKind;
  text: string;
}

/** Lines the log keeps. */
export const LOG_MAX = 50;

interface ISearchState {
  /** The current base (BASE menu, `/base`); undefined: the default base (scope design §5). */
  baseId?: string;
  /** The table the admin chose (TABLE menu, `/table`, a key); undefined: the rotation's. */
  tableId?: string;
  /** The tables of the current base, in menu order (keys 1–9 and `/table` read them). */
  tables: ICockpitTable[];
  query?: IActiveQuery;
  /** Records the chart draws for sure, newest first (scope design §7.3). */
  forced: string[];
  /** The result clicked last. */
  selected?: string;
  /** The record in the reader (scope design §8). */
  record?: { tableId: string; recordId: string };
  log: IAskLogEntry[];
  setBase: (baseId: string) => void;
  setTables: (tables: ICockpitTable[]) => void;
  search: (text: string, tableId: string) => void;
  clearSearch: () => void;
  setForced: (forced: string[]) => void;
  /** A result clicked: forced to the front, selected, open in the reader. */
  select: (recordId: string, tableId: string) => void;
  openRecord: (recordId: string, tableId: string) => void;
  closeRecord: () => void;
  addLog: (kind: IAskLogKind, text: string) => void;
  clearLog: () => void;
}

let logIds = 0;

export const useSearchStore = create<ISearchState>()(
  persist(
    (set, get) => ({
      tables: [],
      forced: [],
      log: [],
      setBase: (baseId) =>
        set({
          baseId,
          tableId: undefined,
          tables: [],
          query: undefined,
          forced: [],
          selected: undefined,
          record: undefined,
        }),
      setTables: (tables) => set({ tables }),
      search: (text, tableId) =>
        set({
          query: { text, tableId, nonce: (get().query?.nonce ?? 0) + 1 },
          selected: undefined,
        }),
      clearSearch: () => set({ query: undefined, forced: [], selected: undefined }),
      setForced: (forced) => set({ forced }),
      select: (recordId, tableId) =>
        set({
          forced: forceFirst(get().forced, recordId),
          selected: recordId,
          record: { recordId, tableId },
        }),
      openRecord: (recordId, tableId) => set({ record: { recordId, tableId } }),
      closeRecord: () => set({ record: undefined }),
      addLog: (kind, text) =>
        set({ log: [...get().log, { id: ++logIds, t: Date.now(), kind, text }].slice(-LOG_MAX) }),
      clearLog: () => set({ log: [] }),
    }),
    {
      name: LocalStorageKeys.AgentScope,
      // the scope is a per-browser convenience; it comes back if the base and table still exist
      partialize: (state) => ({ baseId: state.baseId, tableId: state.tableId }),
    }
  )
);

/** The table the cycle holds on is the admin's choice; going on clears it (scope design §5.3). */
useCockpitStore.subscribe((now, before) => {
  if (now.cycle === before.cycle) return;
  const picked = now.cycle.holds.includes('picked') ? currentDataset(now.cycle) : undefined;
  const was = before.cycle.holds.includes('picked') ? currentDataset(before.cycle) : undefined;
  if (picked !== was) useSearchStore.setState({ tableId: picked });
});

/** A search holds the rotation on its table while it is active (scope design §7.2). */
useSearchStore.subscribe((now, before) => {
  if (Boolean(now.query) === Boolean(before.query)) return;
  useCockpitStore.getState().cycleEvent({ type: now.query ? 'hold' : 'release', reason: 'search' });
});
