/* The constellation drawn by D3, ported from the ai-cockpit's tree.ts (cockpit design §5.4,
   overview design §9). D3 owns the <svg>: layers joined by key, glyphs, rims with the branch
   counts, a glide between layouts on d3-timer, pulses on d3-transition, zoom on d3-zoom, and a
   turn applied to the drawn chart as one GPU layer. React only hands it the graph and the view. */
import { easeCubicInOut, easeCubicOut } from 'd3-ease';
import type { HierarchyPointLink } from 'd3-hierarchy';
import { select, type Selection } from 'd3-selection';
import { curveBundle, lineRadial, linkRadial } from 'd3-shape';
import { timer, type Timer } from 'd3-timer';
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import {
  TAU,
  buildTree,
  geometry,
  labelFit,
  labelOf,
  layoutTree,
  type IDatum,
  type IGeometry,
  type ILayoutMode,
  type IPoint,
  type ITreeNode,
} from '../../model/graph/layout';
import type { IGLink, IGraph } from '../../model/graph/types';
import {
  arcPath,
  glyph,
  keyOf,
  leavesOf,
  lerpAngle,
  nodeClass,
  norm,
  rimsOf,
  type IRim,
} from './constellation-marks';

type ILink = HierarchyPointLink<IDatum>;
type IGroup = Selection<SVGGElement, unknown, null, undefined>;
type IPos = Map<string, { x: number; y: number }>;
interface IEdge {
  id: string;
  link: IGLink;
  path: IPoint[];
}

export interface IChartCallbacks {
  /** The pointer on a node or its label (null when it leaves), in client coordinates. */
  onHover(node: ITreeNode | null, x?: number, y?: number): void;
  onPin(id: string): void;
  /** A click on the empty chart or its core. */
  onClear(): void;
  onPointerInside(inside: boolean): void;
}

export interface IChartView {
  mode: ILayoutMode;
  /** Node ids the chart narrows to (the answer's lens), their branches drawn faint. */
  lens: Set<string> | null;
  /** Node ids lit by the trace; the rest dim. */
  lit: Set<string> | null;
  /** Record labels on the rim; off on narrow screens. */
  labels: boolean;
}

/** Charts up to this many nodes plus edges glide and flow; larger ones land in one draw. */
const MOTION_MAX = 400;
/** The turn is baked into the drawn geometry every this many radians; the rest is a CSS turn. */
const REBASE = (6 * Math.PI) / 180;
const GLIDE_MS = 850;
let charts = 0;

export class ConstellationChart {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly gz: IGroup;
  private readonly gc: IGroup;
  private readonly layers: Record<
    'rims' | 'links' | 'edges' | 'nodes' | 'labels' | 'pulse',
    IGroup
  >;
  private readonly zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly observer: ResizeObserver;
  private readonly media?: MediaQueryList;
  private readonly uid = `cst${++charts}`;
  private graph: IGraph | null = null;
  private hier: IPoint | null = null;
  private byId = new Map<string, IPoint>();
  private edges: IEdge[] = [];
  private readonly pos: IPos = new Map();
  private view: IChartView = { mode: 'bundle', lens: null, lit: null, labels: true };
  private width = 0;
  private height = 0;
  private geo: IGeometry = geometry(0, 0, 1);
  private reduced = false;
  private glide: Timer | null = null;
  private fallback = 0;
  private resizing = 0;
  private rot = 0;
  private cssTurn = 0;
  private readonly linkPath = linkRadial<ILink, IPoint>()
    .angle((d) => this.ang(d))
    .radius((d) => d.y);
  private readonly bundlePath = lineRadial<IPoint>()
    .curve(curveBundle.beta(0.85))
    .radius((d) => d.y)
    .angle((d) => this.ang(d));

  constructor(
    private readonly el: SVGSVGElement,
    private readonly cb: IChartCallbacks
  ) {
    this.media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reduced = Boolean(this.media?.matches);
    this.media?.addEventListener?.('change', this.onMotion);
    this.svg = select(el);
    // zoom outside, centring inside: d3-zoom pivots at the pointer only this way round
    this.gz = this.svg.append('g').attr('transform', zoomIdentity.toString());
    this.gc = this.gz.append('g');
    const layer = (k: string) => this.gc.append('g').attr('class', `layer-${k}`);
    this.layers = {
      rims: layer('rims'),
      links: layer('links'),
      edges: layer('edges'),
      nodes: layer('nodes'),
      labels: layer('labels'),
      pulse: layer('pulse'),
    };
    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 8])
      .on('zoom', (ev: D3ZoomEvent<SVGSVGElement, unknown>) => {
        this.gz.attr('transform', ev.transform.toString());
        this.turnLayer();
      });
    this.svg
      .call(this.zoomer)
      .on('dblclick.zoom', () => this.resetZoom())
      .on('click', (ev: MouseEvent) => ev.target === el && cb.onClear())
      .on('pointerenter', () => cb.onPointerInside(true))
      .on('pointerleave', () => {
        cb.onPointerInside(false);
        cb.onHover(null);
      });
    this.observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // the first size lands at once; later ones settle first (a dragged window sends many)
      if (!this.width) return this.resize(width, height);
      clearTimeout(this.resizing);
      this.resizing = window.setTimeout(() => this.resize(width, height), 90);
    });
    this.observer.observe(el);
  }

  /** The graph to draw: a fresh one grows out of the core, the same one glides; `changed` pulse. */
  setModel(graph: IGraph, options: { fresh?: boolean; changed?: Set<string> } = {}) {
    this.graph = graph;
    this.rebuild(options.changed, options.fresh);
  }

  /** Mode, lens and labels change the tree (a rebuild); the lit trace only the focus. */
  setView(patch: Partial<IChartView>) {
    const structural = (['mode', 'lens', 'labels'] as const).some(
      (k) => k in patch && patch[k] !== this.view[k]
    );
    this.view = { ...this.view, ...patch };
    if (structural) this.rebuild();
    else this.applyFocus();
  }

  /**
   * Turns the chart to `radians` (a view offset; the layout does not change). Cheap per call: the
   * GPU turns the drawn layer, and the chart is redrawn only every REBASE radians, when labels
   * re-flip to stay upright as they pass the left half.
   */
  setRotation(radians: number) {
    let delta = norm(radians - this.rot);
    if (delta > Math.PI) delta -= TAU;
    if (Math.abs(delta) >= REBASE) {
      this.rot = radians;
      delta = 0;
      if (this.hier) this.draw();
    }
    this.cssTurn = delta;
    this.turnLayer();
  }

  resetZoom() {
    this.svg
      .transition()
      .duration(this.reduced ? 0 : 500)
      .call(this.zoomer.transform, zoomIdentity);
  }

  /** Large charts hold still: no glide, no flowing dashes. */
  get still() {
    return (this.hier?.descendants().length ?? 0) + this.edges.length > MOTION_MAX;
  }

  destroy() {
    this.glide?.stop();
    clearTimeout(this.fallback);
    clearTimeout(this.resizing);
    this.observer.disconnect();
    this.media?.removeEventListener?.('change', this.onMotion);
    this.svg.interrupt().on('.zoom', null).on('click', null).on('pointerenter pointerleave', null);
    this.svg.selectAll('*').remove();
    this.el.style.transform = '';
  }

  private readonly onMotion = (e: MediaQueryListEvent) => {
    this.reduced = e.matches;
  };

  private ang(d: IPoint) {
    return d.x + this.rot;
  }

  private pt(d: IPoint): [number, number] {
    return [d.y * Math.sin(this.ang(d)), -d.y * Math.cos(this.ang(d))];
  }

  private resize(width: number, height: number) {
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.rebuild();
  }

  /** Lays the tree out again and glides every node from where it was (or from its parent). */
  private rebuild(changed?: Set<string>, fresh?: boolean) {
    if (!this.graph || !this.width) return;
    if (fresh) this.pos.clear();
    const data = buildTree(this.graph, this.view.lens);
    this.geo = geometry(this.width, this.height, leavesOf(data));
    this.gc.attr('transform', `translate(${this.geo.cx},${this.geo.cy})`);
    const h = layoutTree(data, this.view.mode, this.geo.rIn);
    const to: IPos = new Map();
    const from: IPos = new Map();
    h.each((d) => to.set(d.data.id, { x: d.x, y: d.y }));
    h.each((d) => {
      const prev = this.pos.get(d.data.id);
      let anc = d.parent;
      while (!prev && anc && !this.pos.has(anc.data.id)) anc = anc.parent;
      from.set(d.data.id, prev ?? (anc && this.pos.get(anc.data.id)) ?? { x: d.x, y: 0 });
    });
    this.joins(h);
    for (const id of [...this.pos.keys()]) if (!to.has(id)) this.pos.delete(id);
    this.animate(from, to, () => this.pulse(changed), fresh);
    this.turnLayer();
  }

  /** The structure: every layer joined to the tree by key. */
  private joins(h: IPoint) {
    const graph = this.graph!;
    const nodes = h.descendants();
    this.hier = h;
    this.byId = new Map(nodes.map((d) => [d.data.id, d]));
    this.svg.classed('mode-tree', this.view.mode === 'tree').classed('lensing', !!this.view.lens);
    this.layers.links
      .selectAll<SVGPathElement, ILink>('path')
      .data(h.links(), (l) => l.target.data.id)
      .join('path')
      .attr('class', 'v-link');
    this.edges = graph.links
      .filter((l) => this.byId.has(l.source) && this.byId.has(l.target))
      .map((l) => ({
        id: l.id,
        link: l,
        path: this.byId.get(l.source)!.path(this.byId.get(l.target)!),
      }));
    this.layers.edges
      .selectAll<SVGPathElement, IEdge>('path')
      .data(this.edges, (e) => e.id)
      .join('path')
      .attr('class', (e) => `v-edge t-${e.link.tone || 'target'}`);
    // on the frame, so flowing dashes stop as one rule; past 120 active links they go solid
    this.el.parentElement?.classList.toggle('still', this.still);
    this.el.parentElement?.classList.toggle(
      'calm',
      this.edges.filter((e) => e.link.tone === 'route').length > 120
    );
    this.layers.nodes
      .selectAll<SVGGElement, IPoint>('g.v-node')
      .data(nodes, (d) => d.data.id)
      .join((enter) => this.bindPointer(enter.append('g')))
      .attr('class', nodeClass)
      .attr('data-kind', (d) => d.data.node.kind)
      .attr('data-key', (d) => keyOf(d.data.node))
      .each(function (d) {
        glyph(select(this), d);
      });
    this.joinLabels(h, nodes);
    this.applyFocus();
  }

  /** Leaves and actors carry labels; on a crowded or narrow ring only the "+N more" ones do. */
  private joinLabels(h: IPoint, nodes: IPoint[]) {
    const leaves = nodes.filter(
      (d) =>
        d.depth > 0 &&
        (d.data.node.kind === 'actor' || (d.data.node.kind === 'item' && !d.children))
    );
    const fit = labelFit(
      this.geo,
      h.leaves().length,
      !!this.view.lens || this.view.mode === 'tree'
    );
    const hidden = fit.hidden || !this.view.labels;
    this.svg.style('--fs', `${fit.fs.toFixed(2)}px`).classed('no-labels', hidden);
    const labelled = hidden ? leaves.filter((d) => d.data.node.overflow) : leaves;
    this.layers.labels
      .selectAll<SVGTextElement, IPoint>('text')
      .data(labelled, (d) => d.data.id)
      .join((enter) => this.bindPointer(enter.append('text')))
      .attr('class', (d) => {
        const n = d.data.node;
        return ['v-label', n.kind, `t-${n.tone}`, n.alert && 'alert', n.overflow && 'more']
          .filter(Boolean)
          .join(' ');
      })
      .attr('dy', '0.32em')
      .text((d) => labelOf(d.data.node, fit));
  }

  private bindPointer<E extends SVGElement>(sel: Selection<E, IPoint, SVGGElement, unknown>) {
    return sel
      .on('pointerenter pointermove', (ev: PointerEvent, d) =>
        this.cb.onHover(d.data.node, ev.clientX, ev.clientY)
      )
      .on('pointerleave', () => this.cb.onHover(null))
      .on('click', (ev: MouseEvent, d) => {
        ev.stopPropagation();
        if (d.data.node.kind === 'root') this.cb.onClear();
        else this.cb.onPin(d.data.node.id);
      });
  }

  /** The geometry, every frame of a glide and at every rebase of the turn. */
  private draw() {
    const { links, edges, nodes, labels } = this.layers;
    links.selectAll<SVGPathElement, ILink>('path').attr('d', (l) => this.linkPath(l) ?? '');
    edges.selectAll<SVGPathElement, IEdge>('path').attr('d', (e) => this.bundlePath(e.path) ?? '');
    nodes.selectAll<SVGGElement, IPoint>('g.v-node').attr('transform', (d) => {
      const [x, y] = this.pt(d);
      return `translate(${x.toFixed(2)},${y.toFixed(2)})`;
    });
    labels
      .selectAll<SVGTextElement, IPoint>('text')
      .attr('transform', (d) => {
        const a = this.ang(d);
        const out = d.y + (d.data.node.kind === 'actor' ? 11 : 7);
        const flip = norm(a) >= Math.PI ? ' rotate(180)' : '';
        return `rotate(${((a * 180) / Math.PI - 90).toFixed(2)}) translate(${out.toFixed(2)},0)${flip}`;
      })
      .attr('text-anchor', (d) => (norm(this.ang(d)) >= Math.PI ? 'end' : 'start'));
    this.drawRims();
  }

  /** An arc on the rim per top-level branch, with its name and count where they fit. */
  private drawRims() {
    const h = this.hier;
    const graph = this.graph;
    if (!h || !graph) return;
    const rims = rimsOf(h, (d) => this.ang(d), this.geo, graph, this.uid);
    const rr = this.geo.r - 14;
    this.layers.rims
      .selectAll<SVGGElement, IRim>('g.rim')
      .data(rims, (d) => d.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'rim');
        g.append('path').attr('class', 'v-rim');
        g.append('path')
          .attr('class', 'v-rim-guide')
          .attr('id', (d) => d.sid);
        g.append('text')
          .attr('class', 'v-rim-label')
          .append('textPath')
          .attr('href', (d) => `#${d.sid}`)
          .attr('startOffset', '50%')
          .attr('text-anchor', 'middle');
        g.on('click', (ev: MouseEvent, d) => {
          ev.stopPropagation();
          this.cb.onPin(d.id);
        });
        return g;
      })
      .each(function (d) {
        const g = select(this);
        g.select('.v-rim').attr('d', arcPath(rr, d.a0, d.a1, false));
        g.select('.v-rim-guide').attr(
          'd',
          arcPath(d.bottom ? rr + 13 : rr + 5, d.a0, d.a1, d.bottom)
        );
        g.select('textPath').text(d.label);
      });
  }

  /** Glides from the old positions to the new on d3-timer (none when large or reduced). */
  private animate(from: IPos, to: IPos, done: () => void, fresh?: boolean) {
    this.glide?.stop();
    this.glide = null;
    clearTimeout(this.fallback);
    const nodes = this.hier!.descendants();
    const big = this.still;
    const duration = this.reduced || big ? 0 : GLIDE_MS;
    // the <svg> is its own GPU layer (will-change), so fading it costs no repaint
    if (big && fresh && !this.reduced)
      this.el.animate?.([{ opacity: 0.2 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
    const step = (k: number) => {
      const e = easeCubicInOut(k);
      for (const d of nodes) {
        const a = from.get(d.data.id)!;
        const b = to.get(d.data.id)!;
        d.x = k >= 1 ? b.x : lerpAngle(a.x, b.x, e);
        d.y = a.y + (b.y - a.y) * e;
        this.pos.set(d.data.id, { x: d.x, y: d.y });
      }
      this.draw();
    };
    if (!duration) {
      step(1);
      done();
      return;
    }
    step(0);
    this.glide = timer((ms) => {
      const k = Math.min(1, ms / duration);
      step(k);
      if (k < 1 || !this.glide) return;
      this.glide.stop();
      this.glide = null;
      clearTimeout(this.fallback);
      done();
    });
    // frames stop in hidden views: never leave the chart mid-glide
    this.fallback = window.setTimeout(() => {
      if (!this.glide) return;
      this.glide.stop();
      this.glide = null;
      step(1);
      done();
    }, duration + 500);
  }

  /** A ring that spreads from each record that just arrived. */
  private pulse(ids?: Set<string>) {
    if (!ids?.size || this.reduced) return;
    for (const id of ids) {
      const d = this.byId.get(id);
      if (!d) continue;
      const [x, y] = this.pt(d);
      this.layers.pulse
        .append('circle')
        .attr('class', `v-pulse t-${d.data.node.tone || 'ink'}`)
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 3)
        .transition()
        .duration(1800)
        .ease(easeCubicOut)
        .attr('r', 34)
        .style('opacity', 0)
        .remove();
    }
  }

  /** Lit nodes, and the edges and branches between them, stay bright; the rest dim. */
  private applyFocus() {
    const lit = this.view.lit?.size ? this.view.lit : null;
    const on = (id: string) => !!lit && lit.has(id);
    this.svg.classed('focusing', !!lit);
    this.layers.nodes
      .selectAll<SVGGElement, IPoint>('g.v-node')
      .classed('on', (d) => on(d.data.id));
    this.layers.labels
      .selectAll<SVGTextElement, IPoint>('text')
      .classed('on', (d) => on(d.data.id));
    this.layers.edges
      .selectAll<SVGPathElement, IEdge>('path')
      .classed('on', (e) => on(e.link.source) && on(e.link.target));
    this.layers.links
      .selectAll<SVGPathElement, ILink>('path')
      .classed('on', (l) => on(l.source.data.id) && on(l.target.data.id));
  }

  /** Turns the drawn chart as one GPU layer about its centre (after pan and zoom). */
  private turnLayer() {
    const [ox, oy] = zoomTransform(this.el).apply([this.geo.cx, this.geo.cy]);
    this.el.style.transformOrigin = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
    this.el.style.transform = this.cssTurn
      ? `rotate(${((this.cssTurn * 180) / Math.PI).toFixed(3)}deg)`
      : '';
  }
}
