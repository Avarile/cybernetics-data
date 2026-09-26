/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IBaseGraphVo } from '@teable/openapi';
import { vi } from 'vitest';
import { cleanup, render, screen, userEvent } from '@/test-utils';

// The canvas never mounts here: happy-dom's ResizeObserver reports 0x0, and the
// mount is gated on a non-zero size. Everything around it renders for real.
const replace = vi.fn();
const push = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, pathname: '/base/[baseId]/graph', replace, push }),
}));
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBaseId: () => 'bseTest',
  useTableListener: vi.fn(),
}));
vi.mock('./hooks/useGraphData', () => ({
  useGraphSchema: vi.fn(),
  useBaseGraph: vi.fn(),
  useGraphNode: vi.fn(() => ({ data: undefined, isLoading: true, isError: false })),
  useExpandNode: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// eslint-disable-next-line import/order
import { BaseGraph } from './BaseGraph';
// eslint-disable-next-line import/order
import { useBaseGraph, useGraphSchema } from './hooks/useGraphData';
import { SCHEMA } from './utils/fixtures';

const GRAPH: IBaseGraphVo = {
  version: 4,
  etag: '"bg4-test"',
  nodes: [
    {
      id: 'tbl:tblProjects',
      kind: 'table',
      tableId: 'tblProjects',
      recordId: null,
      label: 'projects',
      parentId: null,
      colorKey: 'tbl:tblProjects',
      depth: 0,
      degree: 1,
    },
    {
      id: 'rec:p1',
      kind: 'record',
      tableId: 'tblProjects',
      recordId: 'p1',
      label: 'Launch',
      parentId: 'tbl:tblProjects',
      colorKey: 'tbl:tblProjects',
      depth: 0,
      degree: 1,
    },
  ],
  links: [{ source: 'tbl:tblProjects', target: 'rec:p1', kind: 'hub', fieldId: null }],
  stats: {
    perTable: [{ tableId: 'tblProjects', emitted: 1, truncated: true }],
    nodeCount: 2,
    linkCount: 1,
    truncated: { nodes: true, links: false },
    cyclesDropped: 0,
    danglingLinks: 0,
    groupOrphans: 0,
  },
};

describe('BaseGraph', () => {
  beforeEach(() => {
    vi.mocked(useGraphSchema).mockReturnValue({ data: SCHEMA, isLoading: false } as any);
    vi.mocked(useBaseGraph).mockReturnValue({
      data: GRAPH,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
  });
  afterEach(() => {
    cleanup();
    replace.mockReset();
  });

  it('resolves the default preset and renders panels, legend and truncation', async () => {
    render(<BaseGraph />);

    // No knowledge tables in the fixture → "all tables", system tables excluded.
    expect(
      vi
        .mocked(useBaseGraph)
        .mock.calls.at(-1)?.[0]
        ?.tables.map((t) => t.tableId)
    ).toEqual(['tblProjects', 'tblTasks', 'tblTags']);
    expect(await screen.findByText('auditlog')).toBeTruthy();
    expect(screen.getAllByText('projects').length).toBeGreaterThan(0);
    expect(screen.getByText(/baseGraph:truncated.nodes/)).toBeTruthy();
  });

  it('writes a table toggle to the URL, not the store', async () => {
    render(<BaseGraph />);
    const tags = (await screen.findAllByText('tags'))[0];
    await userEvent.click(tags);
    expect(replace).toHaveBeenCalledTimes(1);
    const url = replace.mock.calls[0][0] as { query: { q: string } };
    expect(typeof url.query.q).toBe('string');
  });
});
