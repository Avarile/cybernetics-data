import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ISearchCard, ISearchPlan, ISearchStep } from '@teable/openapi';
import type { UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, userEvent } from '@/test-utils';
import { useStage } from '../hooks/useStage';
import { buildAgentRequestBody } from '../model/agent-request';
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
}));
vi.mock('./AskContainer', () => ({ AskContainer: () => <textarea aria-label="ask" /> }));
vi.mock('../ui/theme/fonts', () => ({ cockpitFonts: '' }));

const pressToggle = () => userEvent.keyboard('{Control>}j{/Control}');

describe('agent cockpit (cockpit design §4)', () => {
  beforeEach(() => {
    session.isAdmin = true;
    useCockpitStore.setState({ on: false, focus: undefined });
    useSessionStore.setState({ session: null, loading: false, error: undefined });
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
});
