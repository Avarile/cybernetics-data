/* Slow rotation of the constellation, ported from the ai-cockpit's rotate.ts: an angle advanced in
   real time and handed to a callback a few times a second (one turn every four minutes). */
export interface IRotator {
  start(): void;
  stop(): void;
  /** Pauses without stopping, e.g. while the pointer is on a node. */
  hold(): void;
  release(): void;
}

const TAU = Math.PI * 2;
const MAX_STEP_MS = 250;

export function createRotator(
  apply: (radians: number) => void,
  { degPerSecond = 1.5, fps = 8 }: { degPerSecond?: number; fps?: number } = {}
): IRotator {
  const perMs = (degPerSecond * Math.PI) / 180 / 1000;
  const frameMs = 1000 / Math.max(1, fps);
  let angle = 0;
  let raf = 0;
  let last = 0;
  let lastPaint = 0;
  let running = false;
  let held = false;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(now - last, MAX_STEP_MS) : 0;
    last = now;
    if (held || dt <= 0) return;
    angle = (angle + dt * perMs) % TAU;
    if (now - lastPaint >= frameMs) {
      lastPaint = now;
      apply(angle);
    }
  };
  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
      last = 0;
    },
  };
}
