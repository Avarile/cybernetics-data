/* eslint-disable sonarjs/no-duplicate-string */
import type { UIMessage } from 'ai';
import { turnSignal } from './agent-runtime';
import {
  applyApprovals,
  denyPending,
  dropUnknownTools,
  pendingApprovalsOf,
  textOf,
} from './ui-parts';

const waiting = (id: string, toolName = 'delete_records') =>
  ({
    type: `tool-${toolName}`,
    toolCallId: `call-${id}`,
    state: 'approval-requested',
    input: { ids: [id] },
    approval: { id },
  }) as unknown as UIMessage['parts'][number];

describe('ui parts', () => {
  const parts: UIMessage['parts'] = [
    { type: 'text', text: 'I will delete ' },
    { type: 'text', text: 'two records.' },
    waiting('a1'),
    waiting('a2'),
  ];

  it('reads text and pending approvals', () => {
    expect(textOf(parts)).toBe('I will delete two records.');
    expect(pendingApprovalsOf(parts)).toEqual([
      { approvalId: 'a1', toolName: 'delete_records', input: { ids: ['a1'] } },
      { approvalId: 'a2', toolName: 'delete_records', input: { ids: ['a2'] } },
    ]);
  });

  it('applies answers and reports missing or unknown ones', () => {
    const partial = applyApprovals(parts, [{ approvalId: 'a1', approved: true }]);
    expect(partial.missing).toEqual(['a2']);
    const wrong = applyApprovals(parts, [{ approvalId: 'zz', approved: true }]);
    expect(wrong.unknown).toEqual(['zz']);
    const all = applyApprovals(parts, [
      { approvalId: 'a1', approved: true },
      { approvalId: 'a2', approved: false, reason: 'keep it' },
    ]);
    expect(all.missing).toEqual([]);
    expect(pendingApprovalsOf(all.parts)).toEqual([]);
    expect(all.parts[3]).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'a2', approved: false, reason: 'keep it' },
    });
  });

  it('denies everything pending when the admin moves on', () => {
    const denied = denyPending(parts, 'new message');
    expect(denied.slice(2).map((p) => (p as { approval: { approved: boolean } }).approval)).toEqual(
      [
        { id: 'a1', approved: false, reason: 'new message' },
        { id: 'a2', approved: false, reason: 'new message' },
      ]
    );
  });

  it('turns parts of tools that are gone into text', () => {
    const [message] = dropUnknownTools([{ id: 'm', role: 'assistant', parts }], new Set(['other']));
    expect(message.parts.slice(2)).toEqual([
      { type: 'text', text: '[earlier tool call delete_records: approval-requested]' },
      { type: 'text', text: '[earlier tool call delete_records: approval-requested]' },
    ]);
    const [kept] = dropUnknownTools(
      [{ id: 'm', role: 'assistant', parts }],
      new Set(['delete_records'])
    );
    expect(kept.parts).toEqual(parts);
  });

  it('a turn signal aborts on cancel and on timeout', async () => {
    const cancel = new AbortController();
    const a = turnSignal(cancel.signal, 10_000);
    cancel.abort(new Error('stop'));
    expect(a.signal.aborted).toBe(true);
    const b = turnSignal(new AbortController().signal, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.signal.aborted).toBe(true);
  });
});
