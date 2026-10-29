import type { ISearchStatus } from './search.types';

/** Cockpit design §6.8: where a turn is in intent → (choice) → answer. */
export type ITurnPhase = 'intent' | 'choice' | 'answer';
export type ISearchProtocolMode = 'plan' | 'free';

export const CLARIFY_TOOL = 'clarify';
export const PLAN_TOOL = 'plan_search';
export const HIGHLIGHT_TOOL = 'highlight_records';
export const MAX_PLANS_PER_TURN = 3;

/** Toolkits that read or change data: not offered before a plan has run. */
export const dataToolkits = new Set([
  'data_read',
  'data_write',
  'schema',
  'sql_read',
  'knowledge',
  'http',
]);

/** A finished tool call of an earlier step of this turn. */
export interface IToolOutcome {
  toolName: string;
  output: unknown;
}

/** The search status a plan_search result carries (its output may be fenced as untrusted data). */
export function planStatusOf(output: unknown): ISearchStatus | undefined {
  const o = output as Record<string, { status?: unknown } | undefined> | null;
  const status = o?.['untrusted_data']?.status ?? (o as { status?: unknown } | null)?.status;
  return typeof status === 'string' ? (status as ISearchStatus) : undefined;
}

/** The phase after the steps so far: a run plan moves on to answer; an ambiguous anchor to choice. */
export function phaseAfter(start: ITurnPhase, outcomes: IToolOutcome[]): ITurnPhase {
  let phase = start;
  for (const o of outcomes) {
    if (o.toolName !== PLAN_TOOL) continue;
    const status = planStatusOf(o.output);
    if (status === 'needs_choice') phase = 'choice';
    else if (status && status !== 'empty' && status !== 'failed') phase = 'answer';
  }
  return phase;
}

export interface IStepTools {
  /** undefined: every tool. */
  activeTools?: string[];
  /** Forces one tool (the clarify after an ambiguous anchor). */
  forceTool?: string;
}

/**
 * The tools offered at the next step. `toolkitOf` maps each tool to its toolkit. In `free` mode
 * every tool is always offered (the prompt still asks for plans).
 */
export function stepTools(input: {
  mode: ISearchProtocolMode;
  start: ITurnPhase;
  outcomes: IToolOutcome[];
  toolkitOf: Map<string, string>;
}): IStepTools {
  const tools = [...input.toolkitOf.keys()];
  if (input.mode === 'free' || !input.toolkitOf.has(PLAN_TOOL)) return {};
  const phase = phaseAfter(input.start, input.outcomes);
  const plans = input.outcomes.filter((o) => o.toolName === PLAN_TOOL).length;
  const planOk = (name: string) => name !== PLAN_TOOL || plans < MAX_PLANS_PER_TURN;
  if (phase === 'choice' && input.toolkitOf.has(CLARIFY_TOOL)) {
    return { activeTools: [CLARIFY_TOOL], forceTool: CLARIFY_TOOL };
  }
  if (phase === 'answer') return { activeTools: tools.filter(planOk) };
  return {
    activeTools: tools.filter(
      (name) =>
        name !== HIGHLIGHT_TOOL && planOk(name) && !dataToolkits.has(input.toolkitOf.get(name)!)
    ),
  };
}

/** A turn resumed after approvals is past its plan: approvals only come in the answer phase. */
export function startPhase(resumed: boolean): ITurnPhase {
  return resumed ? 'answer' : 'intent';
}
