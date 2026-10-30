import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, userEvent } from '@/test-utils';
import { useCockpitKeys } from '../../hooks/useCockpitKeys';
import { finishGraph, type IGNode } from '../../model/graph/types';
import { useCockpitStore } from '../../state/cockpit-store';
import { Constellation } from './Constellation';

const node = (id: string, kind: IGNode['kind'], parent: string | null): IGNode => ({
  id,
  kind,
  label: id,
  short: null,
  parent,
  tone: 'none',
  ...(kind === 'actor' ? { cardKey: `s3:${id}` } : {}),
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
      <Constellation graph={graph} mode="bundle" onHover={vi.fn()} onPin={vi.fn()} />
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
    useCockpitStore.setState({ view: 'constellation', pinned: undefined });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('draws the zoom outside the centring, so wheel zoom pivots at the pointer', () => {
    const { container } = render(<Chart />);
    const zoomed = container.querySelector('svg')!.firstElementChild!;
    expect(zoomed.getAttribute('transform')).toBe('translate(0,0) scale(1)');
    expect(zoomed.firstElementChild!.getAttribute('transform')).toBe('translate(400,300)');
  });

  it('pins the people in turn with ] and [', async () => {
    render(<Chart />);
    await userEvent.keyboard(']');
    expect(useCockpitStore.getState().pinned).toBe('s3:Ava');
    await userEvent.keyboard(']');
    expect(useCockpitStore.getState().pinned).toBe('s3:Bo');
    await userEvent.keyboard('[[');
    expect(useCockpitStore.getState().pinned).toBe('s3:Ava');
  });
});
