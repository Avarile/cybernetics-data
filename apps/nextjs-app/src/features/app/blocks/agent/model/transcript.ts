import type { IChoicePart, IClarifyOption, IClarifyPart, ISearchPlanPart } from '@teable/openapi';
import { AGENT_DATA_PART } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { isToolPart, toolNameOf, type IAgentChoice, type IAgentToolPart } from './agent-request';

/** Tools the cockpit shows as their own data parts, not as tool rows. */
const shownAsData = new Set(['plan_search', 'clarify', 'highlight_records']);

export type ITranscriptItem =
  | { kind: 'question'; key: string; text: string; choice?: IChoicePart }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'reasoning'; key: string; text: string; streaming: boolean }
  | { kind: 'plan'; key: string; part: ISearchPlanPart }
  | { kind: 'clarify'; key: string; part: IClarifyPart; answered: boolean }
  | { kind: 'tool'; key: string; name: string; part: IAgentToolPart };

type IPart = UIMessage['parts'][number];
const dataOf = <T>(part: IPart) => (part as { data?: T }).data;

/**
 * A message as the ask rail shows it (cockpit design §5.5): the question, the answer's text,
 * its search plan (the legs), questions back to the admin, and other tool calls as rows.
 */
export function transcriptOf(
  message: UIMessage,
  options: { streaming?: boolean; answered?: boolean } = {}
): ITranscriptItem[] {
  const items: ITranscriptItem[] = [];
  if (message.role === 'user') {
    const text = message.parts
      .filter((p): p is Extract<IPart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('');
    const choice = message.parts.find((p) => p.type === AGENT_DATA_PART.choice);
    const meta = (message.metadata as { choice?: IChoicePart } | undefined)?.choice;
    items.push({
      kind: 'question',
      key: message.id,
      text,
      choice: choice ? dataOf<IChoicePart>(choice) : meta,
    });
    return items;
  }
  message.parts.forEach((part, i) => {
    const key = `${message.id}-${i}`;
    if (part.type === 'text' && part.text.trim())
      items.push({ kind: 'text', key, text: part.text });
    else if (part.type === 'reasoning' && part.text.trim()) {
      const last = i === message.parts.length - 1;
      items.push({
        kind: 'reasoning',
        key,
        text: part.text,
        streaming: Boolean(options.streaming && last),
      });
    } else if (part.type === AGENT_DATA_PART.searchPlan) {
      const data = dataOf<ISearchPlanPart>(part);
      if (data) items.push({ kind: 'plan', key, part: data });
    } else if (part.type === AGENT_DATA_PART.clarify) {
      const data = dataOf<IClarifyPart>(part);
      if (data)
        items.push({ kind: 'clarify', key, part: data, answered: Boolean(options.answered) });
    } else if (isToolPart(part) && !shownAsData.has(toolNameOf(part))) {
      items.push({ kind: 'tool', key, name: toolNameOf(part), part });
    }
  });
  return items;
}

/** The clarify card still waiting for the admin: the last message's, if nothing came after. */
export function openClarify(messages: UIMessage[]): IClarifyPart | undefined {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return undefined;
  const part = [...last.parts].reverse().find((p) => p.type === AGENT_DATA_PART.clarify);
  return part ? dataOf<IClarifyPart>(part) : undefined;
}

/** The searches of a thread, in order (from the plan parts its messages keep). */
export function searchesOf(messages: UIMessage[]): ISearchPlanPart[] {
  return messages.flatMap((m) =>
    m.parts
      .filter((p) => p.type === AGENT_DATA_PART.searchPlan)
      .map((p) => dataOf<ISearchPlanPart>(p))
      .filter((d): d is ISearchPlanPart => Boolean(d))
  );
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const ordinals = [/\b(?:first|1st)\b/, /\b(?:second|2nd)\b/, /\b(?:third|3rd)\b/];

/**
 * The option a typed or spoken answer names (cockpit design §8): its label, or "the first /
 * second / third one". Only an answer that names exactly one option counts.
 */
export function matchOption(part: IClarifyPart, text: string): IClarifyOption | undefined {
  const said = squash(text);
  if (!said) return undefined;
  const named = part.options.filter((o) => {
    const label = squash(o.label);
    return (
      label &&
      (said === label || said.includes(label) || (label.includes(said) && said.length >= 4))
    );
  });
  if (named.length === 1) return named[0];
  if (named.length) return undefined;
  const nth = ordinals.findIndex((re) => re.test(said));
  return nth >= 0 ? part.options[nth] : undefined;
}

/** The choice a picked option sends with the message. */
export const choiceFor = (clarifyId: string, option: IClarifyOption): IAgentChoice => ({
  clarifyId,
  optionId: option.id,
  label: option.label,
  ...(option.recordRef ? { recordRef: option.recordRef } : {}),
});
