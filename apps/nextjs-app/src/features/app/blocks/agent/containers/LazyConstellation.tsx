import dynamic from 'next/dynamic';

/** d3 loads with the constellation only, so the board never pays for it (cockpit design §5.4). */
export const LazyConstellation = dynamic(
  () => import('../ui/stage/Constellation').then((m) => m.Constellation),
  { ssr: false }
);
