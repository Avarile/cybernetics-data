import { useRouter } from 'next/router';
import type { RefObject } from 'react';
import { useEffect } from 'react';
import { OVERVIEW_ORDER } from '../model/overview/datasets';
import { searchesOf } from '../model/transcript';
import { useCockpitStore } from '../state/cockpit-store';
import { useSessionStore } from '../state/session-store';

/** `Mod+J` turns the cockpit on or off, anywhere in the app (cockpit design §5.8). */
export function useToggleKey(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j')
        return;
      e.preventDefault();
      useCockpitStore.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** `?agent=on&thread=…` (from /agent deep links) turns the cockpit on, then leaves the URL. */
export function useDeepLink(enabled: boolean) {
  const router = useRouter();
  const { agent, thread, ...rest } = router.query;
  useEffect(() => {
    if (!enabled || agent !== 'on') return;
    useCockpitStore.getState().open(typeof thread === 'string' ? { threadId: thread } : undefined);
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, agent, thread]);
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

type IKeyAction = (root: HTMLElement | null, key: string) => boolean;

const focusComposer: IKeyAction = (root) => {
  root?.querySelector<HTMLElement>('textarea')?.focus();
  return true;
};
/** What the stage shows right now, as it marks itself (overview design §4). */
const shownOf = (root: HTMLElement | null) =>
  root?.querySelector('[data-stage]')?.getAttribute('data-stage') ?? 'overview';
const onOverview = (root: HTMLElement | null) => shownOf(root) === 'overview';
const hasSearch = () => {
  const session = useSessionStore.getState().session;
  return Boolean(
    session &&
      (Object.keys(session.boards).length || searchesOf(session.chat.store.messages).length)
  );
};
/** `V`: overview → board → constellation → overview, once the conversation has a search. */
const switchView: IKeyAction = (root) => {
  const store = useCockpitStore.getState();
  if (!hasSearch()) return false;
  if (onOverview(root)) {
    store.setView('board');
    store.setStage('search');
  } else if (store.view === 'board') store.setView('constellation');
  else store.setStage('overview');
  return true;
};
/** A chart is on the stage: the overview, or a search drawn as a constellation. */
const chartShown = (root: HTMLElement | null) =>
  onOverview(root) || useCockpitStore.getState().view === 'constellation';
const moveLane: IKeyAction = (root, key) => {
  const lanes = [...(root?.querySelectorAll<HTMLElement>('section[id^="lane-"]') ?? [])];
  if (!lanes.length) return false;
  const at = lanes.findIndex((l) => l.contains(document.activeElement));
  const next = lanes[(at + (key === ']' ? 1 : -1) + lanes.length) % lanes.length];
  next.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  next.querySelector<HTMLElement>('article button')?.focus();
  return true;
};
/** The next or previous person on the chart, pinned so their trace stays lit (the cockpit's). */
const moveActor: IKeyAction = (root, key) => {
  const keys = [
    ...(root?.querySelectorAll<SVGElement>('g[data-kind="actor"][data-key]') ?? []),
  ].map((g) => g.getAttribute('data-key')!);
  if (!keys.length) return false;
  const store = useCockpitStore.getState();
  const overview = onOverview(root);
  const at = keys.indexOf((overview ? store.overviewPinned : store.pinned) ?? '');
  const dir = key === ']' ? 1 : -1;
  const next =
    keys[at < 0 ? (dir > 0 ? 0 : keys.length - 1) : (at + dir + keys.length) % keys.length];
  if (overview) store.pinOverview(next);
  else store.pin(next);
  return true;
};
const move: IKeyAction = (root, key) =>
  chartShown(root) ? moveActor(root, key) : moveLane(root, key);
const toggleLayout: IKeyAction = (root) => {
  if (!chartShown(root)) return false;
  const store = useCockpitStore.getState();
  store.setLayout(store.layout === 'tree' ? 'bundle' : 'tree');
  return true;
};
const resetZoom: IKeyAction = (root) => {
  if (!chartShown(root)) return false;
  useCockpitStore.getState().resetZoom();
  return true;
};
/** `1`–`4`: that dataset of the overview, held there. */
const pickDataset: IKeyAction = (root, key) => {
  const dataset = OVERVIEW_ORDER[Number(key) - 1];
  if (!onOverview(root) || !dataset) return false;
  useCockpitStore.getState().cycleEvent({ type: 'pick', id: dataset.id });
  return true;
};
/** `P`: the overview's cycle paused or going on. */
const pause: IKeyAction = (root) => {
  if (!onOverview(root)) return false;
  const store = useCockpitStore.getState();
  const held = store.cycle.holds.some((h) => h === 'paused' || h === 'picked');
  store.cycleEvent(held ? { type: 'resume' } : { type: 'hold', reason: 'paused' });
  return true;
};
const fullScreen: IKeyAction = (root) => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void root?.requestFullscreen?.().catch(() => undefined);
  return true;
};
/**
 * Escape unpins the trace, then drops the answer's lens to everything found (cockpit design
 * §5.8), or on the overview lets the cycle go on; it never turns the cockpit off.
 */
const escape: IKeyAction = (root) => {
  const store = useCockpitStore.getState();
  if (onOverview(root)) {
    if (store.overviewPinned) store.pinOverview(undefined);
    else if (store.cycle.holds.some((h) => h === 'paused' || h === 'picked'))
      store.cycleEvent({ type: 'resume' });
    else return false;
    return true;
  }
  if (store.pinned) store.pin(undefined);
  else if (store.lens !== 'retrieved') store.setLens('retrieved');
  else return false;
  return true;
};
const actions: Record<string, IKeyAction> = {
  '/': focusComposer,
  v: switchView,
  V: switchView,
  '[': move,
  ']': move,
  t: toggleLayout,
  T: toggleLayout,
  '0': resetZoom,
  f: fullScreen,
  F: fullScreen,
  p: pause,
  P: pause,
  '1': pickDataset,
  '2': pickDataset,
  '3': pickDataset,
  '4': pickDataset,
  Escape: escape,
};

/**
 * Keys inside the cockpit (cockpit design §5.8, overview design §7): `/` composer, `V` overview,
 * board or constellation, `[` `]` lanes (board) or people (charts), `T` bundle or tree, `0` reset
 * the zoom, `1`–`4` a dataset and `P` pause (overview), `F` browser full screen, `Mod+Shift+O`
 * new conversation, `Esc` unpins, then drops the lens or resumes the cycle.
 */
export function useCockpitKeys(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        useCockpitStore.getState().selectSearch(undefined);
        useSessionStore.getState().startNew();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const action = actions[e.key];
      if (action?.(root.current, e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [root]);
}
