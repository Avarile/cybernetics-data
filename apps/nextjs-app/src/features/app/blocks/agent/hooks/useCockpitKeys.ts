import { useRouter } from 'next/router';
import type { RefObject } from 'react';
import { useEffect } from 'react';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';
import { holdTable } from './useScope';

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

/** `?agent=on` (from /agent deep links) turns the cockpit on, then leaves the URL. */
export function useDeepLink(enabled: boolean) {
  const router = useRouter();
  const { agent, thread: _thread, ...rest } = router.query;
  useEffect(() => {
    if (!enabled || agent !== 'on') return;
    useCockpitStore.getState().open();
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, agent]);
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

type IKeyAction = (root: HTMLElement | null, key: string) => boolean;

const focusComposer: IKeyAction = (root) => {
  root?.querySelector<HTMLElement>('textarea')?.focus();
  return true;
};
/** The next or previous person on the chart, pinned so their trace stays lit (the cockpit's). */
const moveActor: IKeyAction = (root, key) => {
  const keys = [
    ...(root?.querySelectorAll<SVGElement>('g[data-kind="actor"][data-key]') ?? []),
  ].map((g) => g.getAttribute('data-key')!);
  if (!keys.length) return false;
  const store = useCockpitStore.getState();
  const at = keys.indexOf(store.overviewPinned ?? '');
  const dir = key === ']' ? 1 : -1;
  const next =
    keys[at < 0 ? (dir > 0 ? 0 : keys.length - 1) : (at + dir + keys.length) % keys.length];
  store.pinOverview(next);
  return true;
};
const toggleLayout: IKeyAction = () => {
  const store = useCockpitStore.getState();
  store.setLayout(store.layout === 'tree' ? 'bundle' : 'tree');
  return true;
};
const resetZoom: IKeyAction = () => {
  useCockpitStore.getState().resetZoom();
  return true;
};
/** `1`–`9`: that table of the TABLE menu, held there. */
const pickTable: IKeyAction = (_root, key) => {
  const table = useSearchStore.getState().tables[Number(key) - 1];
  return Boolean(table && holdTable(table.id));
};
/** `P`: the rotation paused or going on. */
const pause: IKeyAction = () => {
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
 * Escape unpins the trace, then clears the search, then lets the rotation go on (scope design
 * §4.3; the reader and the suggestions close before it sees the key). It never turns the
 * cockpit off.
 */
const escape: IKeyAction = () => {
  const store = useCockpitStore.getState();
  const search = useSearchStore.getState();
  if (store.overviewPinned) store.pinOverview(undefined);
  else if (search.query) search.clearSearch();
  else if (store.cycle.holds.some((h) => h === 'paused' || h === 'picked'))
    store.cycleEvent({ type: 'resume' });
  else return false;
  return true;
};
const actions: Record<string, IKeyAction> = {
  '/': focusComposer,
  '[': moveActor,
  ']': moveActor,
  t: toggleLayout,
  T: toggleLayout,
  '0': resetZoom,
  f: fullScreen,
  F: fullScreen,
  p: pause,
  P: pause,
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), pickTable])),
  Escape: escape,
};

/**
 * Keys inside the cockpit (cockpit design §5.8, overview design §7, scope design §4.3): `/` the
 * composer, `[` `]` people on the chart, `T` bundle or tree, `0` reset the zoom, `1`–`9` a table,
 * `P` pause, `F` browser full screen, `Esc` unpins, then clears the search or resumes the cycle.
 */
export function useCockpitKeys(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const action = actions[e.key];
      if (action?.(root.current, e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [root]);
}
