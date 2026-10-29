import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, userEvent } from '@/test-utils';
import { buildAgentRequestBody } from '../model/agent-request';
import { useCockpitStore } from '../state/cockpit-store';
import { useSessionStore } from '../state/session-store';
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
  getAgentStatus: vi.fn(async () => ({ enabled: true, status: 'ok', tables: {} })),
  listAgentThreads: vi.fn(async () => ({
    threads: [{ id: 'recT1', title: 'Cockpit progress', status: 'active' }],
    nextCursor: null,
  })),
  getAgentThreadMessages: vi.fn(async () => ({
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  })),
}));
vi.mock('./AskContainer', () => ({ AskContainer: () => <textarea aria-label="ask" /> }));

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
