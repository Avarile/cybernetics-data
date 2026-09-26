import { Skeleton } from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';

/**
 * `ssr: false` is mandatory: react-force-graph-3d touches `window` at import
 * time. It also keeps three.js out of the initial page chunk.
 */
export const DynamicBaseGraph = dynamic(() => import('./BaseGraph').then((mod) => mod.BaseGraph), {
  loading: () => <Skeleton className="size-full" />,
  ssr: false,
});
