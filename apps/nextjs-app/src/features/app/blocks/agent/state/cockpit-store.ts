import { LocalStorageKeys } from '@cybernetics/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ILayoutMode } from '../model/graph/layout';
import type { ILensMode } from '../model/lens';
import { rememberedThread, useSessionStore } from './session-store';

/** Where the cockpit was opened from: a hint for the agent, never a limit (cockpit design §4.5). */
export interface IAgentFocus {
  baseId?: string;
  tableId?: string;
  viewId?: string;
  tableName?: string;
  /** Rows the admin added from the grid, and the ids of those loaded (at most 100). */
  rows?: number;
  recordIds?: string[];
}

export type ICockpitPalette = 'mono' | 'cyberpunk';
export type ICockpitView = 'board' | 'constellation';

export interface IOpenCockpit {
  threadId?: string;
  focus?: IAgentFocus;
}

interface ICockpitState {
  /** The cockpit has two states: on (full screen) and off (cockpit design §4.1). */
  on: boolean;
  focus?: IAgentFocus;
  palette: ICockpitPalette;
  view: ICockpitView;
  /** The search on the stage; undefined follows the latest one. */
  selectedSearch?: string;
  /** undefined: the board's own default (answer once cited). */
  lens?: ILensMode;
  /** A card whose trace stays lit (clicked). */
  pinned?: string;
  /** The constellation's layout: bundled edges on the rim, or the tree itself. */
  layout: ILayoutMode;
  /** Counts the times the constellation's zoom was reset (`0`); the chart follows it. */
  zoomResets: number;
  open: (options?: IOpenCockpit) => void;
  close: () => void;
  toggle: (options?: IOpenCockpit) => void;
  clearFocus: () => void;
  setPalette: (palette: ICockpitPalette) => void;
  setView: (view: ICockpitView) => void;
  selectSearch: (searchId?: string) => void;
  setLens: (lens?: ILensMode) => void;
  pin: (key?: string) => void;
  setLayout: (layout: ILayoutMode) => void;
  resetZoom: () => void;
}

export const useCockpitStore = create<ICockpitState>()(
  persist(
    (set, get) => ({
      on: false,
      palette: 'mono',
      view: 'board',
      layout: 'bundle',
      zoomResets: 0,
      open: (options = {}) => {
        const sessions = useSessionStore.getState();
        const threadId = options.threadId ?? (sessions.session ? undefined : rememberedThread());
        if (threadId) void sessions.openThread(threadId);
        else sessions.ensure();
        set({ on: true, ...(options.focus ? { focus: options.focus } : {}) });
      },
      close: () => set({ on: false }),
      toggle: (options) => (get().on ? get().close() : get().open(options)),
      clearFocus: () => set({ focus: undefined }),
      setPalette: (palette) => set({ palette }),
      setView: (view) => set({ view }),
      selectSearch: (selectedSearch) => set({ selectedSearch, lens: undefined, pinned: undefined }),
      setLens: (lens) => set({ lens }),
      pin: (pinned) => set({ pinned }),
      setLayout: (layout) => set({ layout }),
      resetZoom: () => set({ zoomResets: get().zoomResets + 1 }),
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
