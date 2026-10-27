import type { UIMessage } from 'ai';
import { parseMarkdownIntoBlocks } from 'streamdown';
import { isToolPart } from '../agent-request';

/** What the agent asks the admin to look at instead of reading it out (voice design §6.2). */
export type ISpeechPointerKind =
  | 'table'
  | 'code'
  | 'form'
  | 'diagram'
  | 'formula'
  | 'image'
  | 'error';

type IBlockKind = Exclude<ISpeechPointerKind, 'form' | 'error'> | 'prose' | 'html';

/**
 * One sentence to speak, or one pointer. Ids stay the same while the reply grows, so the queue can
 * take each one once: `part:block:sentence` for prose, `part:block` for a pointer.
 */
export interface ISpeechSegment {
  id: string;
  kind: 'prose' | 'pointer';
  text: string;
}

export interface ISpeechScriptOptions {
  /** The stream has ended: the last block of every part is complete. */
  final: boolean;
  /** The turn ended with an error. */
  error?: boolean;
  /** The words of a pointer; English by default, the UI language in the app. */
  pointer?: (kind: ISpeechPointerKind, count: number) => string;
}

const nouns: Record<ISpeechPointerKind, [string, string]> = {
  table: ['table', 'tables'],
  code: ['code', 'code blocks'],
  form: ['form', 'forms'],
  diagram: ['diagram', 'diagrams'],
  formula: ['formula', 'formulas'],
  image: ['image', 'images'],
  error: ['screen', 'screen'],
};

export const defaultPointerText = (kind: ISpeechPointerKind, count: number): string => {
  if (kind === 'error') return 'Something went wrong. Please take a look at the screen.';
  const look =
    count > 1
      ? `Please take a look at these ${count} ${nouns[kind][1]}.`
      : `Please take a look at this ${nouns[kind][0]}.`;
  if (kind !== 'form') return look;
  return `${count > 1 ? 'I need your approval for these.' : 'I need your approval for this.'} ${look}`;
};

/** `a | b` over `--- | ---`: a table whose rows do not start with a pipe. */
const isTableWithoutEdges = (block: string) => {
  const [header, delimiter = ''] = block.split('\n', 2);
  return header.includes('|') && /^[\s|]*:?-{3,}/.test(delimiter);
};

/** The kind of a markdown block, from how it starts. */
export const classifyBlock = (block: string): IBlockKind => {
  if (/^(?: {4}|\t)/.test(block)) return 'code';
  const head = block.trimStart();
  if (/^(?:```|~~~)\s*mermaid\b/i.test(head)) return 'diagram';
  if (/^(?:```|~~~)/.test(head)) return 'code';
  if (head.startsWith('$$')) return 'formula';
  if (head.startsWith('|') || isTableWithoutEdges(head)) return 'table';
  if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(head)) return 'image';
  if (/^<[a-z!/]/i.test(head)) return 'html';
  return 'prose';
};

const LINK_ON_SCREEN = 'the link on screen';
const LONG_INLINE_CODE = 40;

/** Markdown of one line as words to say (a port of the old chat panel's `stripForTts`). */
export const speakableText = (line: string): string =>
  line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^(?:\s*>\s?)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s+)?/i, '')
    .replace(/`([^`]+)`/g, (_, code: string) =>
      code.length > LONG_INLINE_CODE ? 'this code' : code.replace(/_/g, ' ')
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/<https?:\/\/[^>]+>/g, LINK_ON_SCREEN)
    .replace(/https?:\/\/[^\s)]+/g, LINK_ON_SCREEN)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}])_(.+?)_(?=[^\p{L}\p{N}]|$)/gu, '$1$2')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/[*`#]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Latin sentence ends count once whitespace follows; CJK ones at once. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)|[。！？]+["'”’」』)\]]*/g;
const CJK_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

const isSpeakable = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** A sentence without an end mark gets one, so the voice pauses after a list item or heading. */
const closeSentence = (text: string) => {
  if (CJK_END.test(text)) return `${text}。`;
  if (/[\p{L}\p{N}]$/u.test(text)) return `${text}.`;
  return text;
};

/** The sentences of a text; the unfinished end is left out unless the text is complete. */
export const splitSentences = (text: string, complete: boolean): string[] => {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index! + match[0].length;
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (complete && rest) sentences.push(closeSentence(rest));
  return sentences.filter(isSpeakable);
};

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);

/** The sentences of a prose block, line by line; only complete lines and sentences if it grows. */
const proseSentences = (block: string, complete: boolean): string[] => {
  const lines = block.split('\n');
  return lines.flatMap((line, i) => {
    if (isTableRow(line) || /^\s*[-*_]{3,}\s*$/.test(line)) return [];
    const text = speakableText(line);
    return text ? splitSentences(text, complete || i < lines.length - 1) : [];
  });
};

/** A long sentence in pieces of at most `max` characters, cut at a comma, then at a space. */
export const splitLong = (text: string, max: number): string[] => {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const comma = Math.max(window.lastIndexOf(', '), window.lastIndexOf('，'));
    const space = window.lastIndexOf(' ');
    const cut = comma > max / 3 ? comma + 1 : space > max / 3 ? space : max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
};

interface IItem {
  id: string;
  part: number;
  text?: string;
  pointer?: ISpeechPointerKind;
}

/** The items of one text part, and the kind of its unfinished last block if it is still growing. */
const textPartItems = (
  text: string,
  part: number,
  complete: boolean
): { items: IItem[]; pending?: IBlockKind } => {
  const blocks = parseMarkdownIntoBlocks(text).filter((b) => b.trim());
  const items: IItem[] = [];
  let pending: IBlockKind | undefined;
  blocks.forEach((block, b) => {
    const settled = complete || b < blocks.length - 1;
    const kind = classifyBlock(block);
    if (!settled) pending = kind;
    if (kind === 'prose') {
      proseSentences(block, settled).forEach((sentence, s) =>
        items.push({ id: `${part}:${b}:${s}`, part, text: sentence })
      );
    } else if (settled && kind !== 'html') {
      items.push({ id: `${part}:${b}`, part, pointer: kind });
    }
  });
  return { items, pending };
};

/**
 * What to say for an agent reply (voice design §6.2): prose sentence by sentence, and a pointer in
 * place of each table, code block, diagram, formula, image and approval form. Run it on every
 * streamed update; a segment appears once it can no longer change.
 */
export function buildSpeechScript(
  message: UIMessage,
  options: ISpeechScriptOptions
): ISpeechSegment[] {
  const pointerText = options.pointer ?? defaultPointerText;
  const items: IItem[] = [];
  const pendingOf = new Map<number, IBlockKind | undefined>();
  const parts = message.parts;
  parts.forEach((part, i) => {
    if (part.type === 'text') {
      const complete = options.final || part.state === 'done' || i < parts.length - 1;
      const result = textPartItems(part.text, i, complete);
      items.push(...result.items);
      if (!complete) pendingOf.set(i, result.pending);
    } else if (isToolPart(part) && part.state === 'approval-requested' && options.final) {
      // a run stops right after asking, so forms are said once the stream has ended
      items.push({ id: `${i}:form`, part: i, pointer: 'form' });
    }
  });
  if (options.error) items.push({ id: 'error', part: parts.length, pointer: 'error' });

  const segments: ISpeechSegment[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.pointer) {
      segments.push({ id: item.id, kind: 'prose', text: item.text! });
      continue;
    }
    // pointers of one kind in a row are one ("these 2 tables"); forms may span tool parts
    let count = 1;
    const sameGroup = (next?: IItem) =>
      !!next &&
      next.pointer === item.pointer &&
      (next.part === item.part || item.pointer === 'form');
    while (sameGroup(items[i + count])) count++;
    const last = items[i + count - 1];
    const isPartTail = !items[i + count] || items[i + count].part !== last.part;
    // the block still streaming in this part may be one more of the same kind: wait for it
    if (isPartTail && pendingOf.has(last.part) && pendingOf.get(last.part) === item.pointer) break;
    segments.push({ id: item.id, kind: 'pointer', text: pointerText(item.pointer, count) });
    i += count - 1;
  }
  return segments;
}
