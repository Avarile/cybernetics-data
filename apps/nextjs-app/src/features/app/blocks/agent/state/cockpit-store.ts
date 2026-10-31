import { LocalStorageKeys } from '@cybernetics/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ILayoutMode } from '../model/graph/layout';
import type { ILensMode } from '../model/lens';
import { reduceCycle, startCycle, type ICycle, type ICycleEvent } from '../model/overview/cycle';
import { searchesOf } from '../model/transcript';
import { rememberedThread, useSessionStore, type AgentSession } from './session-store';

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
/** What the stage shows: the data (overview) or a search (overview design §4.1). */
export type ICockpitStage = 'overview' | 'search';

export interface IOpenCockpit {
  threadId?: string;
  focus?: IAgentFocus;
}

interface ICockpitState {
  /** The cockpit has two states: on (full screen) and off (cockpit design §4.1). */
  on: boolean;
  focus?: IAgentFocus;
  palette: ICockpitPalette;
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
  stage: ICockpitStage;
  /** The overview's loop through the tables of the current base. */
  cycle: ICycle;
  /** An overview node whose trace stays lit (a node id, not a card key). */
  overviewPinned?: string;
  /** Text the composer takes up once (ASK on an overview node). */
  draft?: string;
  /** Tables that cannot be shown, by id, and why (no access, nothing to draw). */
  overviewFailed: Record<string, string>;
  open: (options?: IOpenCockpit) => void;
  close: () => void;
  toggle: (options?: IOpenCockpit) => void;
  clearFocus: () => void;
  setPalette: (palette: ICockpitPalette) => void;
  selectSearch: (searchId?: string) => void;
  setLens: (lens?: ILensMode) => void;
  pin: (key?: string) => void;
  setLayout: (layout: ILayoutMode) => void;
  resetZoom: () => void;
  setStage: (stage: ICockpitStage) => void;
  /** An event for the overview's cycle, at the current time. */
  cycleEvent: (event: ICycleEvent) => void;
  pinOverview: (id?: string) => void;
  setFocus: (focus?: IAgentFocus) => void;
  setDraft: (draft?: string) => void;
  failDataset: (id: string, reason: string) => void;
}

export const useCockpitStore = create<ICockpitState>()(
  persist(
    (set, get) => ({
      on: false,
      palette: 'mono',
      layout: 'bundle',
      zoomResets: 0,
      stage: 'overview',
      cycle: startCycle([]),
      overviewFailed: {},
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
      selectSearch: (selectedSearch) =>
        set({
          selectedSearch,
          lens: undefined,
          pinned: undefined,
          ...(selectedSearch ? { stage: 'search' as const } : {}),
        }),
      setLens: (lens) => set({ lens }),
      pin: (pinned) => set({ pinned }),
      setLayout: (layout) => set({ layout }),
      resetZoom: () => set({ zoomResets: get().zoomResets + 1 }),
      setStage: (stage) => set({ stage }),
      cycleEvent: (event) => set({ cycle: reduceCycle(get().cycle, event, Date.now()) }),
      pinOverview: (overviewPinned) => set({ overviewPinned }),
      setFocus: (focus) => set({ focus }),
      setDraft: (draft) => set({ draft }),
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

/** A conversation that has searches opens on its latest; a new one opens on the overview. */
const stageOf = (session: AgentSession | null): ICockpitStage =>
  session && searchesOf(session.chat.store.messages).length ? 'search' : 'overview';

useSessionStore.subscribe((now, before) => {
  if (now.session !== before.session)
    useCockpitStore.setState({ stage: stageOf(now.session), overviewPinned: undefined });
});

/** Turns the cockpit on, from anywhere in the app (grid menu, deep links). */
export const openAgentCockpit = (options?: IOpenCockpit) =>
  useCockpitStore.getState().open(options);
