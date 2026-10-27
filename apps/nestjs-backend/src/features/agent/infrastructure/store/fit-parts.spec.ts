import { fitParts, OMITTED_OUTPUT_NOTE, PARTS_OMITTED_TEXT } from './fit-parts';

const max = 4096;
const big = (n: number) => 'x'.repeat(n);
const bytes = (json: string) => Buffer.byteLength(json, 'utf8');
const tool = (id: string, over: Record<string, unknown>) => ({
  type: 'tool-query_records',
  toolCallId: id,
  state: 'output-available',
  input: { table: 'Tasks' },
  ...over,
});

describe('fitParts', () => {
  it('leaves parts that fit alone', () => {
    const json = JSON.stringify([{ type: 'text', text: 'hi' }]);
    expect(fitParts(json, max)).toBe(json);
  });

  it('drops the largest tool outputs first and keeps the text and the calls', () => {
    const parts = [
      { type: 'text', text: 'Here is what I found.' },
      tool('small', { output: { rows: big(500) } }),
      tool('large', { output: { rows: big(6000) } }),
    ];
    const fitted = JSON.parse(fitParts(JSON.stringify(parts), max));
    expect(bytes(JSON.stringify(fitted))).toBeLessThanOrEqual(max);
    expect(fitted[0]).toEqual(parts[0]);
    expect(fitted[1]).toEqual(parts[1]);
    expect(fitted[2]).toMatchObject({
      toolCallId: 'large',
      input: { table: 'Tasks' },
      output: { omitted: true, note: OMITTED_OUTPUT_NOTE },
    });
  });

  it('keeps a waiting approval with its input', () => {
    const approval = {
      type: 'tool-delete_records',
      toolCallId: 'del',
      state: 'approval-requested',
      input: { ids: big(1500) },
      approval: { id: 'ap1' },
    };
    const parts = [
      { type: 'reasoning', text: big(3000) },
      tool('done', { input: { filter: big(1500) }, output: { n: 1 } }),
      approval,
    ];
    const fitted = JSON.parse(fitParts(JSON.stringify(parts), max));
    expect(bytes(JSON.stringify(fitted))).toBeLessThanOrEqual(max);
    expect(fitted[2]).toEqual(approval);
    expect(fitted[0].text).toMatch(/left out/);
  });

  it('cuts a long text only as much as needed', () => {
    const parts = [{ type: 'text', text: big(5000) }];
    const [text] = JSON.parse(fitParts(JSON.stringify(parts), max));
    expect(text.text).toMatch(/cut to save space/);
    expect(text.text.length).toBeGreaterThan(3500);
  });

  it('falls back to the text with a marker for broken JSON or what cannot fit', () => {
    expect(fitParts(big(max + 1), max)).toContain(PARTS_OMITTED_TEXT);
    const calls = Array.from({ length: 80 }, (_, i) => ({
      type: 'tool-delete_records',
      toolCallId: `c${i}`,
      state: 'approval-requested',
      input: { ids: big(100) },
      approval: { id: `a${i}` },
    }));
    const json = fitParts(JSON.stringify([{ type: 'text', text: 'Deleting.' }, ...calls]), max);
    expect(bytes(json)).toBeLessThanOrEqual(max);
    expect(JSON.parse(json)[0].text).toMatch(/^Deleting\./);
  });
});
