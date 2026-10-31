import { LocalStorageKeys } from '@cybernetics/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ILayoutMode } from '../model/graph/layout';
import { reduceCycle, startCycle, type ICycle, type ICycleEvent } from '../model/overview/cycle';

/**
 * Where the cockpit was opened from (the grid's menu): its base and table become the cockpit's
 * scope (scope design D12). The rest is what the grid knows of the rows picked.
 */
export interface IAgentFocus {
  baseId?: string;
  tableId?: string;
  viewId?: string;
  tableName?: string;
  rows?: number;
  recordIds?: string[];
}

export type ICockpitPalette = 'mono' | 'cyberpunk';

export interface IOpenCockpit {
  focus?: IAgentFocus;
}

interface ICockpitState {
  /** The cockpit has two states: on (full screen) and off (cockpit design §4.1). */
  on: boolean;
  /** Where it was opened from, until the scope has taken it (scope design D12). */
  focus?: IAgentFocus;
  palette: ICockpitPalette;
  /** The constellation's layout: bundled edges on the rim, or the tree itself. */
  layout: ILayoutMode;
  /** Counts the times the constellation's zoom was reset (`0`); the chart follows it. */
  zoomResets: number;
  /** The overview's loop through the tables of the current base. */
  cycle: ICycle;
  /** An overview node whose trace stays lit (a node id). */
  overviewPinned?: string;
  /** Tables that cannot be shown, by id, and why (no access, nothing to draw). */
  overviewFailed: Record<string, string>;
  open: (options?: IOpenCockpit) => void;
  close: () => void;
  toggle: (options?: IOpenCockpit) => void;
  setPalette: (palette: ICockpitPalette) => void;
  setLayout: (layout: ILayoutMode) => void;
  resetZoom: () => void;
  /** An event for the overview's cycle, at the current time. */
  cycleEvent: (event: ICycleEvent) => void;
  pinOverview: (id?: string) => void;
  failDataset: (id: string, reason: string) => void;
}

export const useCockpitStore = create<ICockpitState>()(
  persist(
    (set, get) => ({
      on: false,
      palette: 'mono',
      layout: 'bundle',
      zoomResets: 0,
      cycle: startCycle([]),
      overviewFailed: {},
      open: (options = {}) => set({ on: true, focus: options.focus }),
      close: () => set({ on: false }),
      toggle: (options) => (get().on ? get().close() : get().open(options)),
      setPalette: (palette) => set({ palette }),
      setLayout: (layout) => set({ layout }),
      resetZoom: () => set({ zoomResets: get().zoomResets + 1 }),
      cycleEvent: (event) => set({ cycle: reduceCycle(get().cycle, event, Date.now()) }),
      pinOverview: (overviewPinned) => set({ overviewPinned }),
      failDataset: (id, reason) =>
        get().overviewFailed[id] === reason
          ? undefined
          : set({ overviewFailed: { ...get().overviewFailed, [id]: reason } }),
    }),
    {
      name: LocalStorageKeys.AgentCockpit,
      // only the palette is a per-browser preference; on/off never survives a reload
      partialize: (state) => ({ palette: state.palette }),
    }
  )
);

/** Turns the cockpit on, from anywhere in the app (grid menu, deep links). */
export const openAgentCockpit = (options?: IOpenCockpit) =>
  useCockpitStore.getState().open(options);
