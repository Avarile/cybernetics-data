/**
 * `d3-force-3d` ships no types and no `@types/d3-force-3d` package exists
 * (checked: `npm view @types/d3-force-3d` 404s). This covers only
 * `forceRadial`, the one export the base graph's sphere layout uses —
 * see `BaseGraphCanvas.tsx`'s force-tuning effect and
 * `graphTheme.ts#SPHERE_RADIUS`.
 */
declare module 'd3-force-3d' {
  export interface IForceRadial<NodeDatum> {
    (alpha: number): void;
    strength(strength: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    radius(radius: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
  }

  export function forceRadial<NodeDatum = unknown>(
    radius: number,
    x?: number,
    y?: number,
    z?: number
  ): IForceRadial<NodeDatum>;
}
