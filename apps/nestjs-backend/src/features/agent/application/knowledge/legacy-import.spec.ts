import { documentsOf, joinChunks } from './legacy-import';

const text = Array.from(
  { length: 300 },
  (_, i) => `Sentence ${i} of the quarterly report covers revenue and costs.`
).join(' ');

describe('legacy import', () => {
  it('rebuilds a document from chunks with 400 characters of overlap', () => {
    const chunks = [
      text.slice(0, 4000),
      text.slice(3600, 7600),
      text.slice(7200, 11_000),
      text.slice(10_600),
    ];
    expect(joinChunks(chunks)).toBe(text);
  });

  it('joins chunks without overlap with a blank line', () => {
    expect(joinChunks(['First part.', 'Second part.'])).toBe('First part.\n\nSecond part.');
    expect(joinChunks([])).toBe('');
  });

  it('groups chunks by document in order', () => {
    const docs = documentsOf([
      {
        materialId: 'm1',
        docName: 'Report',
        chunkIndex: 0,
        text: 'Alpha beta gamma delta epsilon.',
      },
      {
        materialId: 'm1',
        docName: 'Report',
        chunkIndex: 1,
        text: 'gamma delta epsilon. Zeta eta.',
      },
      { materialId: 'm2', docName: 'Notes', chunkIndex: 0, text: 'Notes text.' },
    ]);
    expect(docs).toEqual([
      { docName: 'Report', text: 'Alpha beta gamma delta epsilon. Zeta eta.' },
      { docName: 'Notes', text: 'Notes text.' },
    ]);
  });
});
