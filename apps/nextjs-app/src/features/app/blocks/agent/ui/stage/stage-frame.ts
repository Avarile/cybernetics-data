import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import { sameFrame, type IFrame } from '../../model/graph/layout';

const VARS = ['--hud-t', '--hud-r', '--hud-b', '--hud-l'] as const;

/**
 * The free area of the full-bleed stage (the cockpit's syncFrame): the HUD is inset below the
 * annunciator, left of the rail and inside the deck, and the chart centres right of the readout,
 * clear of its corner. A boxed stage (the stacked layout, ≤1180px) has no frame, and its totals
 * move above it.
 */
export function useStageFrame(
  stageRef: RefObject<HTMLElement>,
  readoutRef: RefObject<HTMLElement>
) {
  const [frame, setFrame] = useState<IFrame | null>(null);
  const [boxed, setBoxed] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const deck = stage.closest<HTMLElement>('[data-deck]');
    const strip = deck?.querySelector('[data-annunciator]');
    const rail = deck?.querySelector('[data-rail]');
    const sync = () => {
      const isBoxed = getComputedStyle(stage).position !== 'absolute';
      setBoxed(isBoxed);
      if (isBoxed) {
        VARS.forEach((v) => stage.style.removeProperty(v));
        setFrame(null);
        return;
      }
      const sr = stage.getBoundingClientRect();
      const top = Math.max(0, (strip?.getBoundingClientRect().bottom ?? sr.top) - sr.top + 8);
      const right = rail ? Math.max(0, sr.right - rail.getBoundingClientRect().left + 12) : 12;
      const left = deck ? Math.max(0, deck.getBoundingClientRect().left - sr.left) : 0;
      [top, right, 12, left].forEach((px, i) =>
        stage.style.setProperty(VARS[i], `${Math.round(px)}px`)
      );
      const ro = readoutRef.current?.getBoundingClientRect();
      const rx = ro ? ro.right - sr.left : left;
      const next: IFrame = {
        x0: Math.max(left, rx + 16),
        x1: sr.width - right,
        ...(ro ? { clear: { x: rx, y: ro.bottom - sr.top } } : {}),
      };
      setFrame((was) => (sameFrame(was, next) ? was : next));
    };
    let timer = 0;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, 60);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(soon);
    [strip, rail, readoutRef.current].forEach((el) => el && observer?.observe(el));
    window.addEventListener('resize', soon);
    sync();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', soon);
    };
  }, [stageRef, readoutRef]);

  return { frame, boxed };
}
