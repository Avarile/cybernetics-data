import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ISearchCard, ISearchPlan, ISearchStep } from '@teable/openapi';
import type { UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, userEvent } from '@/test-utils';
import { useStage } from '../hooks/useStage';
import { buildAgentRequestBody } from '../model/agent-request';
import { startCycle } from '../model/overview/cycle';
import { useCockpitStore } from '../state/cockpit-store';
import { AgentSession, useSessionStore } from '../state/session-store';
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
  listAgentThreads: vi.fn(async () => ({
    threads: [{ id: 'recT1', title: 'Cockpit progress', status: 'active' }],
    nextCursor: null,
  })),
  getAgentThreadMessages: vi.fn(async () => ({
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  })),
  getAgentOverview: vi.fn(async (dataset: string) => ({
    dataset,
    title: dataset.toUpperCase(),
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

/** A conversation with one search live on its board (no stored messages). */
const liveSearch = () => {
  const live = new AgentSession({ initialMessages: [] });
  const steps: ISearchStep[] = [
    {
      id: 's1',
      table: { id: 'tblprojects', name: 'projects' },
      role: 'anchor',
      purpose: 'projects',
      source: { kind: 'search', text: 'Cockpit', filter: undefined },
      limit: 50,
    },
  ];
  const plan: ISearchPlan = {
    id: 'srch9',
    intent: 'project_progress',
    summary: 'Cockpit',
    baseId: 'bse1',
    missing: [],
    steps,
  };
  const states = [{ stepId: 's1', status: 'done' as const, found: 1, shown: 1 }];
  live.apply({ type: 'plan', searchId: 'srch9', plan, states, status: 'done' });
  return { live, plan, states };
};
vi.mock('./AskContainer', () => ({ AskContainer: () => <textarea aria-label="ask" /> }));
vi.mock('../ui/theme/fonts', () => ({ cockpitFonts: '' }));

const pressToggle = () => userEvent.keyboard('{Control>}j{/Control}');

describe('agent cockpit (cockpit design §4)', () => {
  beforeEach(() => {
    session.isAdmin = true;
    useSessionStore.setState({ session: null, loading: false, error: undefined });
    useCockpitStore.setState({
      on: false,
      focus: undefined,
      stage: 'overview',
      view: 'board',
      overviewPinned: undefined,
      draft: undefined,
      cycle: startCycle(['work', 'knowledge', 'people', 'finance']),
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

  it('opens on the overview, and a search that starts takes the stage', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    expect(await screen.findByRole('region', { name: 'Overview' })).toBeTruthy();
    expect(await screen.findByText('GOAL → PROJECT → TASK')).toBeTruthy();
    // a plan arriving live (not a replay) moves the stage to the search
    const { plan, states } = liveSearch();
    const part = {
      type: 'data-search-plan',
      data: { searchId: 'srchLive', plan: { ...plan, id: 'srchLive' }, states, status: 'running' },
    };
    const chat = useSessionStore.getState().session!.chat as unknown as {
      onData: (p: unknown) => void;
    };
    act(() => chat.onData(part));
    expect(useCockpitStore.getState().stage).toBe('search');
    expect(await screen.findAllByRole('region', { name: 'Search board' })).not.toHaveLength(0);
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
      'knowledge',
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

  it('keeps search keys on a search: the board ignores T and 0, Escape unpins then drops the lens', async () => {
    const { live } = liveSearch();
    useSessionStore.setState({ session: live, loading: false, error: undefined });
    const keep = { layout: 'bundle' as const, zoomResets: 0, lens: undefined };
    useCockpitStore.setState({ ...keep, stage: 'search', view: 'board', pinned: 's1:recP' });
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    await screen.findAllByRole('region', { name: 'Search board' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await userEvent.keyboard('t0');
    expect(useCockpitStore.getState()).toMatchObject(keep);
    act(() => useCockpitStore.setState({ view: 'constellation' }));
    await userEvent.keyboard('t0');
    expect(useCockpitStore.getState()).toMatchObject({ layout: 'tree', zoomResets: 1 });
    await userEvent.keyboard('{Escape}');
    expect(useCockpitStore.getState()).toMatchObject({ pinned: undefined, lens: undefined });
    await userEvent.keyboard('{Escape}');
    expect(useCockpitStore.getState().lens).toBe('retrieved');
    // V leaves the search for the overview from the constellation
    await userEvent.keyboard('v');
    expect(useCockpitStore.getState().stage).toBe('overview');
  });

  it('asks about a pinned overview node: the focus points at it, the composer gets the question', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    await screen.findByText('GOAL → PROJECT → TASK');
    act(() => useCockpitStore.setState({ overviewPinned: 'rec:T' }));
    await userEvent.click(await screen.findByRole('button', { name: 'ASK' }));
    expect(useCockpitStore.getState().focus).toMatchObject({
      baseId: 'bse1',
      tableId: 'tblTasks',
      recordIds: ['recT'],
    });
    expect(useCockpitStore.getState().draft).toBe('Tell me about the task "Voice"');
  });

  it('keeps the conversation while off', async () => {
    render(<AgentCockpitHost />);
    act(() => useCockpitStore.getState().open());
    const first = useSessionStore.getState().session;
    expect(first).toBeTruthy();
    act(() => useCockpitStore.getState().close());
    act(() => useCockpitStore.getState().open());
    expect(useSessionStore.getState().session).toBe(first);
  });

  it('opens a thread asked for, and shows nothing to non-admins', async () => {
    const view = render(<AgentCockpitHost />);
    await act(async () => useCockpitStore.getState().open({ threadId: 'recT1' }));
    expect(useSessionStore.getState().session?.threadId).toBe('recT1');
    expect(useSessionStore.getState().session?.chat.store.messages).toHaveLength(1);
    expect(await screen.findByText('Cockpit progress')).toBeTruthy();
    view.unmount();
    session.isAdmin = false;
    render(<AgentCockpitHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends the option of a clarify card with the message', () => {
    const choice = { clarifyId: 'clr1', optionId: 'o2', label: 'Cybernetics Cockpit' };
    const message = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'the first' }],
      metadata: { choice },
    } as UIMessage;
    expect(buildAgentRequestBody([message], { threadId: 'recT1' })).toEqual({
      threadId: 'recT1',
      message: { text: 'the first', choice },
    });
  });
});

describe('the stage (cockpit design §5.3)', () => {
  const step = (id: string, table: string, role: ISearchStep['role']): ISearchStep => ({
    id,
    table: { id: `tbl${table}`, name: table },
    role,
    purpose: table,
    source: { kind: 'search', text: 'Cockpit', filter: undefined },
    limit: 50,
  });
  const plan: ISearchPlan = {
    id: 'srch1',
    intent: 'project_progress',
    summary: 'Cockpit',
    baseId: 'bse1',
    missing: [],
    steps: [step('s1', 'projects', 'anchor'), step('s2', 'tasks', 'related')],
  };
  const card = (stepId: string, recordId: string, extra: Partial<ISearchCard> = {}) => ({
    key: `${stepId}:${recordId}`,
    stepId,
    recordId,
    tableId: stepId === 's1' ? 'tblprojects' : 'tbltasks',
    table: stepId === 's1' ? 'projects' : 'tasks',
    title: recordId,
    short: null,
    tone: 'none' as const,
    fields: [],
    ...extra,
  });
  const via = { stepId: 's1', recordId: 'recP', field: 'tasks' };

  beforeEach(() => {
    const live = new AgentSession({ initialMessages: [] });
    const states = plan.steps.map((s) => ({
      stepId: s.id,
      status: 'done' as const,
      found: 1,
      shown: 1,
    }));
    live.apply({ type: 'plan', searchId: 'srch1', plan, states, status: 'done' });
    live.apply({ type: 'hit', searchId: 'srch1', card: card('s1', 'recP') });
    live.apply({ type: 'hit', searchId: 'srch1', card: card('s2', 'recT1', { tone: 'ink', via }) });
    live.apply({
      type: 'hit',
      searchId: 'srch1',
      card: card('s2', 'recT2', { tone: 'route', via }),
    });
    live.apply({ type: 'lens', searchId: 'srch1', recordKeys: ['s2:recT1'] });
    useSessionStore.setState({ session: live, loading: false, error: undefined });
    useCockpitStore.setState({
      view: 'constellation',
      selectedSearch: undefined,
      lens: undefined,
      pinned: undefined,
    });
  });

  it('keeps the answer lens and the readout while a card is pinned or hovered', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStage(), { wrapper });
    expect(result.current.lensMode).toBe('answer');
    expect(result.current.graphLens).toEqual(new Set(['recT1']));
    const metrics = result.current.metrics;

    // the pinned task is not cited: it lights up, the chart and the numbers stay as they were
    act(() => result.current.pin('s2:recT2'));
    expect(result.current.graphLens).toEqual(new Set(['recT1']));
    expect(result.current.graphLit).toEqual(new Set(['recT2', 'recP']));
    expect(result.current.metrics).toEqual(metrics);
    expect(result.current.lit).toEqual(new Set(['s2:recT2', 's1:recP']));

    act(() => result.current.hoverRecord('recP'));
    expect(result.current.graphLens).toEqual(new Set(['recT1']));
    expect(result.current.metrics).toEqual(metrics);
  });

  it('settles a search the reply left running, but not one replayed from the server', () => {
    const live = new AgentSession({ initialMessages: [] });
    const states = plan.steps.map((s) => ({
      stepId: s.id,
      status: 'pending' as const,
      found: 0,
      shown: 0,
    }));
    live.apply({ type: 'plan', searchId: 'srch2', plan, states, status: 'running' });
    live.apply({
      type: 'step',
      searchId: 'srch2',
      state: { stepId: 's1', status: 'running', found: 0, shown: 0 },
    });
    live.apply({
      type: 'replay',
      search: {
        id: 'srch3',
        plan,
        status: 'running',
        states,
        cards: [],
        lens: [],
      } as never,
    });
    live.settle();
    expect(live.boards.srch2.status).toBe('cancelled');
    expect(live.boards.srch2.states.s1.status).toBe('cancelled');
    expect(live.boards.srch3.status).toBe('running');
  });
});
