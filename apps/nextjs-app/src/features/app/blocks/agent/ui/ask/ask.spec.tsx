/* eslint-disable sonarjs/no-duplicate-string */
import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, userEvent } from '@/test-utils';
import {
  answeredApprovals,
  buildAgentRequestBody,
  waitingApprovals,
} from '../../model/agent-request';
import { parseInput, suggest } from '../../model/commands';
import { formatUsage } from '../../model/format';
import { isClearCommand, matchSkills } from '../../model/skills';
import { ApprovalCard } from './ApprovalCard';
import { AgentComposer, SEARCH_IDLE_MS } from './Composer';
import { AgentToolStep } from './ToolStep';

const user = (text: string): UIMessage => ({
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text }],
});
const reply = (state: string, approval?: object): UIMessage =>
  ({
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'I will delete it.' },
      {
        type: 'tool-delete_records',
        toolCallId: 'c1',
        state,
        input: { tableId: 'tbl1', recordIds: ['rec1'] },
        ...(approval ? { approval } : {}),
      },
    ],
  }) as unknown as UIMessage;

describe('agent request body', () => {
  it('sends only the new message, with thread and context', () => {
    expect(
      buildAgentRequestBody([reply('output-available'), user('Next one')], {
        threadId: 'recT',
        context: { baseId: 'bse1' },
      })
    ).toEqual({ threadId: 'recT', context: { baseId: 'bse1' }, message: { text: 'Next one' } });
  });

  it('sends the answers when the last reply had approvals answered', () => {
    const answered = reply('approval-responded', { id: 'ap1', approved: false, reason: 'no' });
    expect(answeredApprovals(answered)).toEqual([
      { approvalId: 'ap1', approved: false, reason: 'no' },
    ]);
    expect(buildAgentRequestBody([user('x'), answered], { threadId: 'recT' })).toEqual({
      threadId: 'recT',
      approvals: [{ approvalId: 'ap1', approved: false, reason: 'no' }],
    });
    expect(waitingApprovals(reply('approval-requested', { id: 'ap1' }))).toHaveLength(1);
    expect(() => buildAgentRequestBody([], {})).toThrow();
  });
});

describe('ApprovalCard', () => {
  it('shows the call and answers once', async () => {
    const onRespond = vi.fn();
    render(
      <ApprovalCard
        approvalId="ap1"
        toolName="delete_records"
        input={{ recordIds: ['rec1'] }}
        onRespond={onRespond}
      />
    );
    expect(screen.getByText(/delete_records/)).toBeInTheDocument();
    expect(screen.getByText(/rec1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onRespond).toHaveBeenCalledWith('ap1', true);
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    cleanup();
  });

  it('is disabled while a reply streams', () => {
    render(<ApprovalCard approvalId="ap1" toolName="x" input={{}} disabled onRespond={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    cleanup();
  });
});

describe('AgentToolStep', () => {
  const part = (state: string, extra: object = {}) =>
    ({
      type: 'tool-delete_records',
      toolCallId: 'c1',
      state,
      input: { recordIds: ['rec1'] },
      ...extra,
    }) as never;

  it('renders a finished step without an approval card', () => {
    render(
      <AgentToolStep
        part={part('output-available', { output: { deleted: 1 } })}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-tool-delete_records')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Approval needed' })).toBeNull();
    cleanup();
  });

  it('adds the approval card while the call waits', async () => {
    const onRespond = vi.fn();
    render(
      <AgentToolStep
        part={part('approval-requested', { approval: { id: 'ap9' } })}
        onRespond={onRespond}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onRespond).toHaveBeenCalledWith('ap9', false);
    cleanup();
  });
});

describe('AgentComposer, the command line (scope design §6)', () => {
  const bases = [
    { id: 'bse1', name: 'data-centre' },
    { id: 'bse2', name: 'demo_database' },
    { id: 'bse3', name: 'primary_database_2' },
  ];
  const tables = [
    { id: 'tbl1', name: 'tasks' },
    { id: 'tbl2', name: 'finance_Transactions' },
  ];
  const setup = () => {
    const onSubmit = vi.fn((text: string) => text.startsWith('/'));
    const onIdle = vi.fn();
    const onPick = vi.fn();
    render(
      <AgentComposer
        placeholder="Search TASKS · /base · /table"
        suggestionsFor={(v) => suggest(parseInput(v), bases, tables, 'bse1')}
        onSubmit={onSubmit}
        onIdle={onIdle}
        onPick={onPick}
      />
    );
    return { onSubmit, onIdle, onPick, input: screen.getByRole('combobox') };
  };
  const options = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('offers the two commands on /, every base on /base, and only data-centre on /base dat', async () => {
    const { input } = setup();
    await userEvent.type(input, '/');
    expect(options().map((o) => o.split('<')[0])).toEqual(['/base', '/table']);
    await userEvent.type(input, 'base');
    expect(options().map((o) => o.replace(/database$/, ''))).toEqual([
      'data-centre',
      'demo_database',
      'primary_database_2',
    ]);
    await userEvent.type(input, ' dat');
    expect(options().map((o) => o.replace(/database$/, ''))).toEqual(['data-centre']);
  });

  it('moves with the arrows, completes with Tab, applies with Enter', async () => {
    const { input, onPick } = setup();
    await userEvent.type(input, '/table ');
    await userEvent.keyboard('{ArrowDown}{Tab}');
    expect(input).toHaveValue('/table finance_Transactions');
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'table', id: 'tbl2', name: 'finance_Transactions' })
    );
    expect(input).toHaveValue('');
  });

  it('closes the list with Escape, then Enter submits the text', async () => {
    const { input, onSubmit } = setup();
    await userEvent.type(input, '/base nothing-like-it{Escape}');
    expect(options()).toEqual([]);
    await userEvent.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('/base nothing-like-it');
  });

  it('searches on Enter and keeps the query in the input to refine', async () => {
    const { input, onSubmit } = setup();
    await userEvent.type(input, 'deploy{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('deploy');
    expect(input).toHaveValue('deploy');
  });

  it('hands the text over once the input has been still for 3 s, once', () => {
    vi.useFakeTimers();
    const { input, onIdle } = setup();
    fireEvent.change(input, { target: { value: 'dep' } });
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS - 100));
    fireEvent.change(input, { target: { value: 'deploy' } });
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS - 1));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith('deploy');
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS * 2));
    expect(onIdle).toHaveBeenCalledTimes(1);
    // an emptied input never hands anything over
    fireEvent.change(input, { target: { value: '  ' } });
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS * 2));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('knows the clear commands', () => {
    expect(['/clear', ' /new ', '/CLEAR'].every(isClearCommand)).toBe(true);
    expect(['/clear now', 'clear', '/clearance'].some(isClearCommand)).toBe(false);
  });

  it('matches skills after a slash', () => {
    const skills = [
      { name: 'data-navigation' },
      { name: 'document-search' },
      { name: 'memory-hygiene' },
    ];
    expect(matchSkills('/d', skills).map((s) => s.name)).toEqual([
      'data-navigation',
      'document-search',
    ]);
    expect(matchSkills('/', skills)).toHaveLength(3);
    expect(matchSkills('hello /d', skills)).toEqual([]);
  });

  it('formats thread usage', () => {
    expect(formatUsage({ tokensIn: 900, tokensOut: 300, costUsd: 0.0123 })).toBe(
      '1.2k tok · $0.0123'
    );
    expect(formatUsage({ tokensIn: null, tokensOut: null, costUsd: null })).toBe('0 tok');
  });
});
