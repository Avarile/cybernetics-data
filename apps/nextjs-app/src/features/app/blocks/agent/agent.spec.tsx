/* eslint-disable sonarjs/no-duplicate-string */
import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, userEvent } from '@/test-utils';
import { answeredApprovals, buildAgentRequestBody, waitingApprovals } from './agent-request';
import { formatUsage } from './AgentPage';
import { matchSkills } from './components/AgentComposer';
import { AgentToolStep } from './components/AgentToolStep';
import { ApprovalCard } from './components/ApprovalCard';

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

describe('helpers', () => {
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
