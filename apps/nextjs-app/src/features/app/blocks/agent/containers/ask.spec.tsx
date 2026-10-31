import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, userEvent } from '@/test-utils';
import { startCycle } from '../model/overview/cycle';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';
import { AskContainer } from './AskContainer';

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
      { id: 'bse3', name: 'primary_database_2', spaceId: 'spc1', spaceName: 'Work' },
    ],
    defaultBaseId: 'bse1',
  })),
  getCockpitTables: vi.fn(async (baseId: string) => ({
    baseId,
    tables: [
      { id: 'tblTasks', name: 'tasks' },
      { id: 'tblKnow', name: 'knowledges' },
    ],
  })),
  searchCockpitTable: vi.fn(async (tableId: string, query: { q: string }) => ({
    tableId,
    q: query.q,
    total: 0,
    results: [],
  })),
}));
vi.mock('../ui/theme/fonts', () => ({ cockpitFonts: '' }));

const input = () => screen.getByRole('combobox');

describe('the ask panel as a command line (scope design §6)', () => {
  beforeEach(() => {
    useCockpitStore.setState({ cycle: startCycle(['tblTasks', 'tblKnow']) });
    useSearchStore.setState({
      baseId: undefined,
      tableId: undefined,
      tables: [],
      query: undefined,
      forced: [],
      log: [],
    });
  });
  afterEach(cleanup);

  it('has no suggested questions and no other commands', async () => {
    render(<AskContainer />);
    await screen.findByText(/Type to search TASKS/);
    expect(screen.queryByText('How is my latest project going?')).toBeNull();
    await userEvent.type(input(), '/');
    expect(screen.getAllByRole('option').map((o) => o.textContent?.split('<')[0])).toEqual([
      '/base',
      '/table',
    ]);
  });

  it('/base with a name changes the base and logs it; an unknown name says so', async () => {
    render(<AskContainer />);
    await screen.findByText(/Type to search TASKS/);
    await userEvent.type(input(), '/base nope{Escape}{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('NO BASE NAMED "nope"');
    await userEvent.clear(input());
    await userEvent.type(input(), '/base dat');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    expect(useSearchStore.getState().baseId).toBe('bse1');
    await userEvent.type(input(), '/base dem{Enter}');
    expect(useSearchStore.getState().baseId).toBe('bse2');
    expect(useSearchStore.getState().log.map((l) => [l.kind, l.text])).toEqual([
      ['base', 'data-centre'],
      ['base', 'demo_database'],
    ]);
    expect(input()).toHaveValue('');
  });

  it('/table holds that table on the stage', async () => {
    render(<AskContainer />);
    await screen.findByText(/Type to search TASKS/);
    await userEvent.type(input(), '/table know');
    await userEvent.keyboard('{Enter}');
    const { cycle } = useCockpitStore.getState();
    expect([cycle.order[cycle.index], cycle.holds]).toEqual([
      'tblKnow',
      expect.arrayContaining(['picked']),
    ]);
  });

  it('searches plain text on the table on the stage, holding it while typed', async () => {
    render(<AskContainer />);
    await screen.findByText(/Type to search TASKS/);
    await userEvent.type(input(), 'deploy');
    expect(useCockpitStore.getState().cycle.holds).toContain('typing');
    await userEvent.keyboard('{Enter}');
    expect(useSearchStore.getState().query).toMatchObject({ text: 'deploy', tableId: 'tblTasks' });
    expect(useCockpitStore.getState().cycle.holds).toEqual(expect.arrayContaining(['search']));
    expect(input()).toHaveValue('deploy');
    // Enter on the same text runs it again
    const nonce = useSearchStore.getState().query!.nonce;
    await userEvent.keyboard('{Enter}');
    expect(useSearchStore.getState().query!.nonce).toBe(nonce + 1);
    await userEvent.clear(input());
    await userEvent.type(input(), '/foo{Escape}{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('UNKNOWN COMMAND');
  });

  it('CLEAR empties the log and the search', async () => {
    render(<AskContainer />);
    await screen.findByText(/Type to search TASKS/);
    act(() => {
      useSearchStore.getState().search('x', 'tblTasks');
      useSearchStore.getState().addLog('query', '"x" · 0 IN TASKS');
    });
    await userEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
    expect(useSearchStore.getState()).toMatchObject({ query: undefined, log: [] });
  });
});
