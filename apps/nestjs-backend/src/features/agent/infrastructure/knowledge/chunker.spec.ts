import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  chunkDocument,
  chunkRecord,
  chunkSection,
  SECTION_MAX,
  sentences,
  SINGLE_CHUNK_MAX,
} from './chunker';

const sentence = (i: number) => `This is sentence number ${i} about quarterly revenue in EMEA.`;
const paragraph = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => sentence(from + i)).join(' ');

describe('chunker', () => {
  it('splits sentences, including CJK full stops', () => {
    expect(sentences('One. Two! Three? 四。五！')).toEqual([
      'One.',
      'Two!',
      'Three?',
      '四。',
      '五！',
    ]);
  });

  it('keeps a short section as one chunk', () => {
    const text = paragraph(1, 10);
    expect(text.length).toBeLessThanOrEqual(SINGLE_CHUNK_MAX);
    expect(chunkSection(text)).toEqual([text]);
  });

  it('chunks long sections near the size, at sentence ends, with overlap', () => {
    const text = paragraph(1, 80);
    const chunks = chunkSection(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_SIZE + CHUNK_OVERLAP);
      expect(c.endsWith('.')).toBe(true);
    }
    // each chunk starts with whole sentences from the end of the previous one, within the overlap
    for (let i = 1; i < chunks.length; i++) {
      const at = chunks[i - 1].indexOf(sentences(chunks[i])[0]);
      const carried = chunks[i - 1].slice(at);
      expect(at).toBeGreaterThan(0);
      expect(carried.length).toBeLessThanOrEqual(CHUNK_OVERLAP);
      expect(chunks[i].startsWith(carried)).toBe(true);
    }
    // nothing is lost
    for (let i = 1; i <= 80; i++) expect(chunks.some((c) => c.includes(sentence(i)))).toBe(true);
  });

  it('hard-splits text without sentence boundaries', () => {
    const blob = 'x'.repeat(3500);
    const chunks = chunkSection(blob);
    expect(chunks.every((c) => c.length <= CHUNK_SIZE)).toBe(true);
    expect(chunks.join('')).toBe(blob);
  });

  it('follows markdown headings with their trail, ignoring headings in code fences', () => {
    const md = [
      '# Q3 Report',
      'Intro text.',
      '## Revenue',
      'Revenue grew.',
      '### EMEA',
      'EMEA was strong.',
      '```',
      '# not a heading',
      '```',
      '## Costs',
      'Costs fell.',
    ].join('\n');
    const sections = chunkDocument(md, 'markdown');
    expect(sections.map((s) => s.headingPath)).toEqual([
      'Q3 Report',
      'Q3 Report › Revenue',
      'Q3 Report › Revenue › EMEA',
      'Q3 Report › Costs',
    ]);
    expect(sections[2].content).toContain('# not a heading');
  });

  it('splits very long sections at paragraph boundaries', () => {
    const big = ['# Big', ...Array.from({ length: 12 }, (_, i) => paragraph(i * 10, 8))].join(
      '\n\n'
    );
    const sections = chunkDocument(big, 'markdown');
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.headingPath === 'Big')).toBe(true);
    expect(sections.every((s) => s.content.length <= SECTION_MAX)).toBe(true);
  });

  it('groups plain-text paragraphs into sections', () => {
    const text = Array.from({ length: 6 }, (_, i) => paragraph(i * 5, 4)).join('\n\n');
    const sections = chunkDocument(text, 'text');
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.headingPath === null)).toBe(true);
    expect(sections.flatMap((s) => s.chunks).join(' ')).toContain(sentence(0));
  });

  it('makes one section of a record, titled by its title', () => {
    expect(chunkRecord('VPN setup', 'Install the client.')).toEqual([
      {
        headingPath: 'VPN setup',
        content: 'VPN setup\n\nInstall the client.',
        chunks: ['VPN setup\n\nInstall the client.'],
      },
    ]);
    expect(chunkRecord(null, '  ')).toEqual([]);
    expect(chunkDocument('   ')).toEqual([]);
  });
});
