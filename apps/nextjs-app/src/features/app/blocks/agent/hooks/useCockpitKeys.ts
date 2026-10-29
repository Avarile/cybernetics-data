import { useRouter } from 'next/router';
import type { RefObject } from 'react';
import { useEffect } from 'react';
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
const switchView: IKeyAction = () => {
  const store = useCockpitStore.getState();
  store.setView(store.view === 'board' ? 'constellation' : 'board');
  return true;
};
const moveLane: IKeyAction = (root, key) => {
  const lanes = [...(root?.querySelectorAll<HTMLElement>('section[id^="lane-"]') ?? [])];
  const at = lanes.findIndex((l) => l.contains(document.activeElement));
  const next = lanes[(at + (key === ']' ? 1 : -1) + lanes.length) % lanes.length];
  next?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  next?.querySelector<HTMLElement>('article button')?.focus();
  return Boolean(next);
};
const fullScreen: IKeyAction = (root) => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void root?.requestFullscreen?.().catch(() => undefined);
  return true;
};
/** Escape unpins the trace, then drops the lens; it never turns the cockpit off. */
const escape: IKeyAction = () => {
  const store = useCockpitStore.getState();
  if (store.pinned) store.pin(undefined);
  else if (store.lens) store.setLens(undefined);
  else return false;
  return true;
};
const actions: Record<string, IKeyAction> = {
  '/': focusComposer,
  v: switchView,
  V: switchView,
  '[': moveLane,
  ']': moveLane,
  f: fullScreen,
  F: fullScreen,
  Escape: escape,
};

/**
 * Keys inside the cockpit (cockpit design §5.8): `/` composer, `V` board or constellation,
 * `[` `]` lanes, `F` browser full screen, `Mod+Shift+O` new conversation, `Esc` unpins the trace,
 * then drops the lens.
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
