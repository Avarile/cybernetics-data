import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useCockpitStore } from '../state/cockpit-store';

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
