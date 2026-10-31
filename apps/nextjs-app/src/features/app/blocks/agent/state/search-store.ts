import { LocalStorageKeys } from '@cybernetics/sdk/config';
import type { ICockpitTable } from '@teable/openapi';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currentDataset } from '../model/overview/cycle';
import { useCockpitStore } from './cockpit-store';

interface ISearchState {
  /** The current base (BASE menu, `/base`); undefined: the default base (scope design §5). */
  baseId?: string;
  /** The table the admin chose (TABLE menu, `/table`, a key); undefined: the rotation's. */
  tableId?: string;
  /** The tables of the current base, in menu order (keys 1–9 read them). */
  tables: ICockpitTable[];
  setBase: (baseId: string) => void;
  setTables: (tables: ICockpitTable[]) => void;
}

export const useSearchStore = create<ISearchState>()(
  persist(
    (set) => ({
      tables: [],
      setBase: (baseId) => set({ baseId, tableId: undefined, tables: [] }),
      setTables: (tables) => set({ tables }),
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
