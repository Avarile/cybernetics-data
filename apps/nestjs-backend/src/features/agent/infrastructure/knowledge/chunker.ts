import type { IRagSection } from '../../domain/ports';

/**
 * Structure-aware chunking (design §11.2). Sections follow the document's headings (or blank-line
 * paragraphs for plain text); chunks are ~1000 characters with 120 of overlap at sentence
 * boundaries. The numbers change only with an evaluation run that shows the effect (§11.6).
 */
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 120;
/** A section up to this size stays a single chunk. */
export const SINGLE_CHUNK_MAX = 1200;
/** Longer sections are split at paragraph boundaries. */
export const SECTION_MAX = 4000;
/** Plain-text paragraphs are merged into sections up to this size. */
export const PLAIN_SECTION_TARGET = 1200;

export type IChunkFormat = 'markdown' | 'text';

const headingRe = /^(#{1,3})[ \t](.*)$/;

/** Sentences, keeping their punctuation; CJK full stops count too. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|(?<=[。！？])\s*|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cut text that has no usable sentence boundary. */
const hardSplit = (text: string, size: number) => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

/** ~CHUNK_SIZE pieces of a section, each starting with the tail of the previous one. */
export function chunkSection(text: string): string[] {
  const body = text.trim();
  if (!body) return [];
  if (body.length <= SINGLE_CHUNK_MAX) return [body];
  const parts = sentences(body).flatMap((s) =>
    s.length > CHUNK_SIZE ? hardSplit(s, CHUNK_SIZE) : [s]
  );
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const part of parts) {
    if (size + part.length > CHUNK_SIZE && current.length) {
      chunks.push(current.join(' '));
      // carry whole sentences from the end, up to the overlap
      const carry: string[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (carried + current[i].length > CHUNK_OVERLAP) break;
        carry.unshift(current[i]);
        carried += current[i].length + 1;
      }
      current = carry;
      size = carried;
    }
    current.push(part);
    size += part.length + 1;
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}

/** Paragraph groups no longer than `max` (a single longer paragraph stays whole). */
function groupParagraphs(text: string, max: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const groups: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > max) {
      groups.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) groups.push(current);
  return groups;
}

const toSections = (headingPath: string | null, text: string): IRagSection[] =>
  groupParagraphs(text, SECTION_MAX).map((content) => ({
    headingPath,
    content,
    chunks: chunkSection(content),
  }));

/** Markdown: one section per heading (#–###), with the heading trail as its path. */
function markdownSections(text: string): IRagSection[] {
  const sections: IRagSection[] = [];
  const trail: string[] = [];
  let buffer: string[] = [];
  let path: string | null = null;
  let inFence = false;
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push(...toSections(path, content));
    buffer = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : headingRe.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      trail.length = level - 1;
      trail[level - 1] = m[2].replace(/#+$/, '').trim();
      path = trail.filter(Boolean).join(' › ');
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

/** Split a document into sections and chunks. */
export function chunkDocument(text: string, format: IChunkFormat = 'markdown'): IRagSection[] {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  if (format === 'markdown' && /^#{1,3}\s/m.test(clean)) return markdownSections(clean);
  return groupParagraphs(clean, PLAIN_SECTION_TARGET).flatMap((content) =>
    toSections(null, content)
  );
}

/**
 * A record (kb_records, agent_memory): one section (design §11.2 step 4). The title is its heading,
 * so keyword search sees it; the body is the content, or the title when there is no body.
 */
export function chunkRecord(title: string | null, body: string | null): IRagSection[] {
  const head = title?.trim() || null;
  const content = body?.trim() || head;
  if (!content) return [];
  return [{ headingPath: head, content, chunks: chunkSection(content) }];
}
