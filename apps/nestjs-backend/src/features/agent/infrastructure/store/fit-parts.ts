/* eslint-disable @typescript-eslint/no-explicit-any */

/** What stays of a tool output that did not fit. */
export const OMITTED_OUTPUT_NOTE =
  'Left out to save space; call the tool again for the full result.';
export const PARTS_OMITTED_TEXT = '[parts omitted: larger than 64 KB]';
const keptErrorChars = 2000;

type IPart = Record<string, any>;

const bytes = (parts: IPart[]) => Buffer.byteLength(JSON.stringify(parts), 'utf8');
const size = (value: unknown) => (value === undefined ? 0 : JSON.stringify(value).length);
const isTool = (p: IPart) =>
  typeof p.type === 'string' && (p.type.startsWith('tool-') || p.type === 'dynamic-tool');
/** States whose input the admin still has to see or answer. */
const waiting = new Set(['approval-requested', 'approval-responded']);

/** Replaces values, largest first, until the parts fit; true when they do. */
function shrinkLargest(
  parts: IPart[],
  maxBytes: number,
  pick: (p: IPart) => boolean,
  measure: (p: IPart) => number,
  /** `over`: how many bytes too big the parts are right now. */
  replace: (p: IPart, over: number) => IPart
) {
  const order = parts
    .map((p, i) => ({ i, n: pick(p) ? measure(p) : 0 }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  for (const { i } of order) {
    const over = bytes(parts) - maxBytes;
    if (over <= 0) return true;
    parts[i] = replace(parts[i], over);
  }
  return bytes(parts) <= maxBytes;
}

/**
 * Fits a message's parts JSON into `maxBytes` (agent_messages.parts is capped, design §7.2,
 * current-design §7 E4) by giving up what can be had again, in this order: tool outputs (largest
 * first; the call stays, with a note), long tool errors, reasoning, the inputs of finished tool
 * calls, and at last the end of long texts. Tool calls and approvals are always kept, so a waiting
 * approval can still be answered. Only when even that is too big, or the JSON is broken, does a
 * marker with the message's text replace the parts.
 */
export function fitParts(json: string, maxBytes: number): string {
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return json;
  let parts: IPart[];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) throw new Error('not a list');
    parts = parsed.map((p) => ({ ...(p as IPart) }));
  } catch {
    return JSON.stringify([{ type: 'text', text: PARTS_OMITTED_TEXT }]);
  }

  const fits =
    shrinkLargest(
      parts,
      maxBytes,
      (p) => isTool(p) && p.output !== undefined && !p.output?.omitted,
      (p) => size(p.output),
      (p) => ({ ...p, output: { omitted: true, chars: size(p.output), note: OMITTED_OUTPUT_NOTE } })
    ) ||
    shrinkLargest(
      parts,
      maxBytes,
      (p) => isTool(p) && typeof p.errorText === 'string' && p.errorText.length > keptErrorChars,
      (p) => p.errorText.length,
      (p) => ({ ...p, errorText: `${p.errorText.slice(0, keptErrorChars)}…` })
    ) ||
    shrinkLargest(
      parts,
      maxBytes,
      (p) => p.type === 'reasoning' && typeof p.text === 'string',
      (p) => p.text.length,
      (p) => ({ ...p, text: '[reasoning left out to save space]' })
    ) ||
    shrinkLargest(
      parts,
      maxBytes,
      (p) => isTool(p) && !waiting.has(p.state) && p.input !== undefined && !p.input?.omitted,
      (p) => size(p.input),
      (p) => ({ ...p, input: { omitted: true, chars: size(p.input) } })
    ) ||
    shrinkLargest(
      parts,
      maxBytes,
      (p) => p.type === 'text' && typeof p.text === 'string' && p.text.length > 1000,
      (p) => p.text.length,
      // dropping `over` characters drops at least `over` bytes
      (p, over) => ({
        ...p,
        text: `${p.text.slice(0, Math.max(1000, p.text.length - over - 100))}… [cut to save space]`,
      })
    );
  if (fits) return JSON.stringify(parts);

  const text = parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  // a character takes at most 6 bytes in JSON (\uXXXX)
  const room = Math.max(0, Math.floor(maxBytes / 6) - PARTS_OMITTED_TEXT.length - 10);
  return JSON.stringify([
    { type: 'text', text: `${text.slice(0, room)}\n\n${PARTS_OMITTED_TEXT}` },
  ]);
}
