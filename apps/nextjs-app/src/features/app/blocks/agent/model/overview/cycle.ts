import { DATASET_MS } from './presentation';

/**
 * Why the cycle waits (overview design §6.2, scope design §5.3): `search` while a search is
 * active, `typing` while the composer holds text not sent yet.
 */
export type IHold = 'pointer' | 'pin' | 'picked' | 'paused' | 'hidden' | 'search' | 'typing';

/**
 * The overview's loop through the tables of the current base (by id). `remaining` counts down only while the dataset is
 * drawn and nothing holds; `since` is when it last started counting.
 */
export interface ICycle {
  order: string[];
  index: number;
  remaining: number;
  holds: IHold[];
  /** The dataset is on screen: its minute counts from here, not from when it was asked for. */
  drawn: boolean;
  since?: number;
}

export type ICycleEvent =
  | { type: 'tick' }
  | { type: 'drawn' }
  | { type: 'hold' | 'release'; reason: IHold }
  /** A dataset picked by the admin: shown at once, and held there. */
  | { type: 'pick'; id: string }
  /** ▶ or Esc: the cycle goes on. */
  | { type: 'resume' }
  /** The datasets that can be shown changed. */
  | { type: 'available'; order: string[] }
  /** The overview is back on screen (cockpit on, or back from a search): a fresh minute. */
  | { type: 'restart' };

export const startCycle = (order: string[]): ICycle => ({
  order,
  index: 0,
  remaining: DATASET_MS,
  holds: [],
  drawn: false,
});

export const running = (c: ICycle) => c.drawn && c.holds.length === 0 && c.order.length > 1;

/** Time left in the current dataset at `now`. */
export const remainingAt = (c: ICycle, now: number) =>
  running(c) && c.since !== undefined ? Math.max(0, c.remaining - (now - c.since)) : c.remaining;

export const currentDataset = (c: ICycle): string | undefined => c.order[c.index];

export const nextDataset = (c: ICycle): string | undefined =>
  c.order.length > 1 ? c.order[(c.index + 1) % c.order.length] : undefined;

/** Banks the time that ran since the last change. */
const settle = (c: ICycle, now: number): ICycle =>
  running(c) && c.since !== undefined ? { ...c, remaining: remainingAt(c, now), since: now } : c;

const show = (c: ICycle, index: number): ICycle => ({
  ...c,
  index,
  remaining: DATASET_MS,
  drawn: false,
  since: undefined,
});

/** Starts or stops the clock to match the holds. */
const clock = (c: ICycle, now: number): ICycle => {
  if (!running(c)) return { ...c, since: undefined };
  return c.since === undefined ? { ...c, since: now } : c;
};

const withHolds = (c: ICycle, holds: IHold[]) => ({ ...c, holds: [...new Set(holds)] });

function step(c: ICycle, event: ICycleEvent): ICycle {
  switch (event.type) {
    case 'tick':
      return c.remaining <= 0 && c.order.length ? show(c, (c.index + 1) % c.order.length) : c;
    case 'drawn':
      return { ...c, drawn: true };
    case 'hold':
      return withHolds(c, [...c.holds, event.reason]);
    case 'release':
      return withHolds(
        c,
        c.holds.filter((h) => h !== event.reason)
      );
    case 'pick': {
      const index = c.order.indexOf(event.id);
      if (index < 0) return c;
      const picked = withHolds(c, [...c.holds, 'picked']);
      return index === c.index ? picked : show(picked, index);
    }
    case 'resume':
      return withHolds(
        c,
        c.holds.filter((h) => h !== 'picked' && h !== 'paused')
      );
    case 'restart':
      return show(
        withHolds(
          c,
          c.holds.filter((h) => h !== 'pointer')
        ),
        c.index
      );
    case 'available': {
      const current = currentDataset(c);
      const index = current ? event.order.indexOf(current) : -1;
      const next = { ...c, order: event.order };
      return index >= 0 ? { ...next, index } : show(next, 0);
    }
  }
}

/** The cycle after an event at `now` (ms). Pure. */
export function reduceCycle(c: ICycle, event: ICycleEvent, now: number): ICycle {
  return clock(step(settle(c, now), event), now);
}
