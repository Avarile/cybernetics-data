import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, userEvent, within } from '@/test-utils';
import { startCycle } from '../model/overview/cycle';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';
import { AgentCockpitHost } from './AgentCockpitHost';

const session = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@cybernetics/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({ user: { isAdmin: session.isAdmin } }),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, pathname: '/space', replace: vi.fn() }),
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAgentStatus: vi.fn(async () => ({
    enabled: true,
    status: 'ok',
    tables: {},
    models: [],
    warnings: [],
  })),
  getCockpitBases: vi.fn(async () => ({
    bases: [
      { id: 'bse1', name: 'data-centre', spaceId: 'spc1', spaceName: 'Work' },
      { id: 'bse2', name: 'demo_database', spaceId: 'spc1', spaceName: 'Work' },
    ],
    defaultBaseId: 'bse1',
  })),
  getCockpitTables: vi.fn(async (baseId: string) => ({
    baseId,
    tables:
      baseId === 'bse1'
        ? [
            { id: 'tblWork', name: 'tasks' },
            { id: 'tblKnow', name: 'knowledges' },
            { id: 'tblPeople', name: 'contacts' },
            { id: 'tblFin', name: 'finance_Transactions' },
          ]
        : [{ id: 'tblOrders', name: 'orders' }],
  })),
  setCockpitDefaultBase: vi.fn(async ({ baseId }: { baseId: string }) => ({
    defaultBaseId: baseId,
  })),
  searchCockpitTable: vi.fn(async (tableId: string, query: { q: string }) => ({
    tableId,
    q: query.q,
    total: 2,
    results: [
      {
        recordId: 'recT',
        title: 'Voice',
        snippet: { field: 'notes', text: 'voice mode', match: [0, 5] },
        updatedAt: '2026-10-30T04:12:00.000Z',
      },
      { recordId: 'recFar', title: 'Far away', snippet: null, updatedAt: null },
    ],
  })),
  getAgentTableOverviewNodes: vi.fn(async () => ({
    nodes: [
      {
        id: 'rec:recFar',
        kind: 'item',
        label: 'Far away',
        short: 'TASK',
        parent: 'rec:G',
        tone: 'ink',
        recordId: 'recFar',
        tableId: 'tblWork',
        table: 'tasks',
      },
    ],
    links: [],
  })),
  getAgentTableOverview: vi.fn(async (tableId: string) => ({
    tableId,
    tableName: tableId === 'tblWork' ? 'tasks' : tableId.slice(3).toLowerCase(),
    preset: tableId === 'tblWork' ? 'work' : null,
    presentation: {
      branchTitle: tableId === 'tblWork' ? 'GOAL VECTORS' : 'BRANCHES',
      unit: 'ITEMS',
      right: 'pct',
      toneNames: { route: 'IN PROGRESS' },
      legend: [['route', 'IN PROGRESS']],
    },
    title: tableId.slice(3).toUpperCase(),
    path: 'GOAL → PROJECT → TASK',
    baseId: 'bse1',
    nodes: [
      { id: 'rec:G', kind: 'hub', label: 'Ship', short: 'GOAL', parent: null, tone: 'none' },
      {
        id: 'rec:T',
        kind: 'item',
        label: 'Voice',
        short: 'TASK',
        parent: 'rec:G',
        tone: 'route',
        recordId: 'recT',
        tableId: 'tblTasks',
        table: 'tasks',
      },
    ],
    links: [],
    counts: { goals: 1, tasks: 1 },
    missing: [],
    truncated: false,
    builtAt: '2026-10-30T04:12:00.000Z',
  })),
}));

vi.mock('./AskContainer', () => ({ AskContainer: () => <textarea aria-label="ask" /> }));
vi.mock('../ui/theme/fonts', () => ({ cockpitFonts: '' }));

const pressToggle = () => userEvent.keyboard('{Control>}j{/Control}');

describe('agent cockpit (cockpit design §4)', () => {
  beforeEach(() => {
    session.isAdmin = true;
    useCockpitStore.setState({
      on: false,
      focus: undefined,
      overviewPinned: undefined,
      overviewFailed: {},
      cycle: startCycle([]),
    });
    useSearchStore.setState({
      baseId: undefined,
      tableId: undefined,
      tables: [],
      query: undefined,
      forced: [],
      selected: undefined,
      record: undefined,
      log: [],
    });
  });
  afterEach(cleanup);

  it('is on or off: the shortcut and the power button switch it, Escape does not', async () => {
    render(<AgentCockpitHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await pressToggle();
    expect(await screen.findByRole('dialog', { name: 'Agent cockpit' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.click(screen.getByTitle('Turn the cockpit off (Ctrl/⌘ J)'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await pressToggle();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('lays the overview out as the ai-cockpit: the ask and the branches in the rail, a table menu', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    const rail = (await screen.findByRole('region', { name: 'GOAL VECTORS' })).parentElement!;
    expect(rail.firstElementChild?.getAttribute('aria-label')).toBe('ask');
    // the feed of recent records is gone from the overview
    expect(screen.queryByRole('region', { name: 'RECENT WORK' })).toBeNull();
    // a branch in the vectors stays lit when clicked
    await userEvent.click(await screen.findByRole('button', { name: /Ship/ }));
    expect(useCockpitStore.getState().overviewPinned).toBe('rec:G');
    // the table menu lists the tables of the base; a pick holds that one
    await userEvent.click(await screen.findByRole('button', { name: 'TABLE TASKS' }));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    await userEvent.click(screen.getByRole('option', { name: /KNOWLEDGES/ }));
    const cycle = useCockpitStore.getState().cycle;
    expect([cycle.order[cycle.index], cycle.holds]).toEqual([
      'tblKnow',
      expect.arrayContaining(['picked']),
    ]);
    expect(useSearchStore.getState().tableId).toBe('tblKnow');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the base with its default star; another base restarts the rotation on its tables', async () => {
    const { setCockpitDefaultBase } = await import('@teable/openapi');
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    const star = await screen.findByRole('button', { name: 'data-centre is the default base' });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'data-centre DEFAULT' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Make demo_database the default base' })
    );
    expect(setCockpitDefaultBase).toHaveBeenCalledWith({ baseId: 'bse2' });
    await userEvent.click(screen.getByRole('button', { name: 'demo_database' }));
    expect(useSearchStore.getState().baseId).toBe('bse2');
    expect(await screen.findByRole('button', { name: 'TABLE ORDERS' })).toBeTruthy();
    const cycle = useCockpitStore.getState().cycle;
    expect(cycle.order).toEqual(['tblOrders']);
  });

  it('drives the overview by key: T, 0, a dataset by number, P and Escape', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    await screen.findByRole('region', { name: 'Overview' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() =>
      useCockpitStore.setState({ layout: 'bundle', zoomResets: 0, overviewPinned: 'rec:T' })
    );
    await userEvent.keyboard('t0');
    expect(useCockpitStore.getState()).toMatchObject({ layout: 'tree', zoomResets: 1 });
    await userEvent.keyboard('2');
    const cycle = () => useCockpitStore.getState().cycle;
    expect([cycle().order[cycle().index], cycle().holds]).toEqual([
      'tblKnow',
      expect.arrayContaining(['picked']),
    ]);
    await userEvent.keyboard('{Escape}');
    expect(useCockpitStore.getState().overviewPinned).toBeUndefined();
    await userEvent.keyboard('{Escape}');
    expect(cycle().holds).not.toContain('picked');
    await userEvent.keyboard('p');
    expect(cycle().holds).toContain('paused');
    await userEvent.keyboard('p');
    expect(cycle().holds).not.toContain('paused');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stacks BUNDLE and TREE under the readout, with no view buttons', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    const stage = await screen.findByRole('region', { name: 'Overview' });
    const knobs = within(stage).getByRole('group', { name: 'Layout' });
    expect(
      within(knobs)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['BUNDLE', 'TREE']);
    // under the readout, in the top-left corner of the HUD
    expect(knobs.parentElement?.firstElementChild?.textContent).toMatch(/OVERVIEW/);
    for (const name of ['OVERVIEW', 'BOARD', 'CONSTELLATION'])
      expect(within(stage).queryByRole('button', { name })).toBeNull();
    await userEvent.click(within(knobs).getByRole('button', { name: 'TREE' }));
    expect(useCockpitStore.getState().layout).toBe('tree');
  });

  it('reads a pinned overview node: READ opens it in the reader', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    await screen.findByText('GOAL → PROJECT → TASK');
    act(() => useCockpitStore.setState({ overviewPinned: 'rec:T' }));
    expect(screen.queryByRole('button', { name: 'ASK' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'READ' }));
    expect(useSearchStore.getState().record).toMatchObject({
      recordId: 'recT',
      tableId: 'tblTasks',
    });
  });

  it('lists a search in Search Results, forces its results onto the chart, and lights a click', async () => {
    const { getAgentTableOverviewNodes } = await import('@teable/openapi');
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    await screen.findByRole('button', { name: 'TABLE TASKS' });
    expect(await screen.findByText(/TYPE TO SEARCH TASKS/)).toBeTruthy();
    act(() => useSearchStore.getState().search('voice', 'tblWork'));
    const panel = await screen.findByRole('region', { name: 'SEARCH RESULTS' });
    expect(await within(panel).findByText('2 FOUND · TASKS')).toBeTruthy();
    // both results are forced: the one the overview did not read is fetched and drawn
    await vi.waitFor(() => expect(useSearchStore.getState().forced).toEqual(['recT', 'recFar']));
    await vi.waitFor(() =>
      expect(getAgentTableOverviewNodes).toHaveBeenCalledWith('tblWork', { recordIds: ['recFar'] })
    );
    expect(await screen.findByText('RESULTS 2 · 2 ON CHART')).toBeTruthy();
    // the search holds the rotation on its table
    expect(useCockpitStore.getState().cycle.holds).toContain('search');
    await userEvent.click(within(panel).getByRole('button', { name: /Far away/ }));
    expect(useSearchStore.getState()).toMatchObject({
      selected: 'recFar',
      record: { recordId: 'recFar', tableId: 'tblWork' },
    });
    expect(useCockpitStore.getState().overviewPinned).toBe('rec:recFar');
    // Escape unpins, then clears the search
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await userEvent.keyboard('{Escape}');
    expect(useCockpitStore.getState().overviewPinned).toBeUndefined();
    await userEvent.keyboard('{Escape}');
    expect(useSearchStore.getState().query).toBeUndefined();
    expect(useCockpitStore.getState().cycle.holds).not.toContain('search');
  });

  it('shows nothing to non-admins', () => {
    session.isAdmin = false;
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opened from the grid, takes its base and holds its table', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open({ focus: { baseId: 'bse1', tableId: 'tblPeople' } }));
    await vi.waitFor(() => {
      const { cycle } = useCockpitStore.getState();
      expect([cycle.order[cycle.index], cycle.holds]).toEqual([
        'tblPeople',
        expect.arrayContaining(['picked']),
      ]);
    });
    expect(useSearchStore.getState().baseId).toBe('bse1');
  });
});
