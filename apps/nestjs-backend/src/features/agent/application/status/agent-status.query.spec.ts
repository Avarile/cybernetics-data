import type { IAgentModelStatus } from '@teable/openapi';
import { buildWarnings, pickDefaultSetup } from './agent-status.query';

const okView = { enabled: true, status: 'ok' as const, lastError: null, health: null };
const chat = (over: Partial<IAgentModelStatus> = {}): IAgentModelStatus => ({
  slot: 'model',
  ref: 'openai/gpt-4.1',
  ok: true,
  ...over,
});
const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe('pickDefaultSetup', () => {
  it('prefers the active default, then the first active row', () => {
    const rows = [
      { name: 'old', is_default: true, is_active: false },
      { name: 'a', is_active: true },
      { name: 'b', is_default: true, is_active: true },
    ];
    expect(pickDefaultSetup(rows)?.name).toBe('b');
    expect(pickDefaultSetup(rows.slice(0, 2))?.name).toBe('a');
    expect(pickDefaultSetup([{ is_active: false }])).toBeUndefined();
  });
});

describe('buildWarnings', () => {
  it('has nothing to say about a healthy agent', () => {
    expect(buildWarnings(okView, [chat()], true)).toEqual([]);
  });

  it('reports a disabled agent and does not judge its models', () => {
    const w = buildWarnings({ ...okView, enabled: false }, [], true);
    expect(codes(w)).toEqual(['not_enabled']);
  });

  it('reports a broken installation with its error', () => {
    const w = buildWarnings(
      { ...okView, status: 'needs_setup', lastError: 'base in trash' },
      [],
      true
    );
    expect(w).toEqual([{ code: 'installation', message: 'base in trash' }]);
  });

  it('reports a missing chat model, unresolvable models, the key and retyped fields', () => {
    const view = {
      ...okView,
      health: { mismatched: [{ field: 'agent_threads.summary', expected: 'longText' }] },
    };
    const models = [
      chat({ ref: null, ok: false }),
      { slot: 'small_model' as const, ref: 'gone/x', ok: false, error: 'not configured' },
    ];
    expect(codes(buildWarnings(view, models, false))).toEqual([
      'secrets_key_missing',
      'field_type_changed',
      'no_chat_model',
      'model_unavailable',
    ]);
  });
});
