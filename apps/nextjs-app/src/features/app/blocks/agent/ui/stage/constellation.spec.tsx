import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, userEvent } from '@/test-utils';
import { useCockpitKeys } from '../../hooks/useCockpitKeys';
import type * as LayoutModule from '../../model/graph/layout';
import { finishGraph, type IGNode } from '../../model/graph/types';
import { useCockpitStore } from '../../state/cockpit-store';
import { Constellation } from './Constellation';

const layouts = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../model/graph/layout', async (importOriginal) => {
  const real = await importOriginal<typeof LayoutModule>();
  return {
    ...real,
    layoutTree: (...args: Parameters<typeof real.layoutTree>) => {
      layouts.count++;
      return real.layoutTree(...args);
    },
  };
});

const node = (id: string, kind: IGNode['kind'], parent: string | null): IGNode => ({
  id,
  kind,
  label: id,
  short: null,
  parent,
  tone: 'none',
});
const graph = finishGraph({
  title: 'Cockpit',
  nodes: [
    node('P', 'item', null),
    node('g:people', 'hub', null),
    node('Ava', 'actor', 'g:people'),
    node('Bo', 'actor', 'g:people'),
  ],
  links: [],
});

/** The chart in a cockpit-like root, with the cockpit's keys. */
const Chart = () => {
  const root = useRef<HTMLDivElement>(null);
  useCockpitKeys(root);
  return (
    <div ref={root}>
      <section>
        <Constellation graph={graph} mode="bundle" onHover={vi.fn()} onPin={vi.fn()} />
      </section>
    </div>
  );
};

describe('constellation (cockpit design §5.4)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly cb: ResizeObserverCallback) {}
        observe() {
          this.cb([{ contentRect: { width: 800, height: 600 } } as never], this as never);
        }
        disconnect = vi.fn();
      }
    );
    useCockpitStore.setState({ overviewPinned: undefined });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('draws the zoom outside the centring, so wheel zoom pivots at the pointer', () => {
    const { container } = render(<Chart />);
    const zoomed = container.querySelector('svg')!.firstElementChild!;
    expect(zoomed.getAttribute('transform')).toBe('translate(0,0) scale(1)');
    expect(zoomed.firstElementChild!.getAttribute('transform')).toBe('translate(400,304)');
  });

  it('pins the people in turn with ] and [', async () => {
    render(<Chart />);
    await userEvent.keyboard(']');
    expect(useCockpitStore.getState().overviewPinned).toBe('Ava');
    await userEvent.keyboard(']');
    expect(useCockpitStore.getState().overviewPinned).toBe('Bo');
    await userEvent.keyboard('[[');
    expect(useCockpitStore.getState().overviewPinned).toBe('Ava');
  });

  it('turns as one layer: a CSS turn on the drawn chart, the layout not run again', async () => {
    const { container } = render(<Chart />);
    const before = layouts.count;
    expect(before).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(container.querySelector('svg')!.style.transform).toMatch(/^rotate\(0\.\d+deg\)$/);
    expect(layouts.count).toBe(before);
  });

  it('draws with D3: a node per record by key, diamonds for people, rims for the branches', () => {
    const { container } = render(<Chart />);
    const kinds = [...container.querySelectorAll('g.v-node')].map((g) =>
      g.getAttribute('data-kind')
    );
    expect(kinds.sort()).toEqual(['actor', 'actor', 'hub', 'item', 'root']);
    expect(container.querySelectorAll('g.v-node.actor path.dia')).toHaveLength(2);
    expect(container.querySelectorAll('g.rim')).toHaveLength(2);
    expect(container.querySelector('g.v-node[data-key="Ava"]')).not.toBeNull();
  });
});
