import { sourceRefOf } from '../../application/knowledge/rag-jobs';
import { cellText, htmlToText, looksMarkdown } from './text-extract';

describe('knowledge text extraction', () => {
  it('turns an HTML page into readable text with its title', () => {
    const page = htmlToText(
      `<html><head><title> Leave policy </title><style>p{color:red}</style></head>
       <body><script>alert(1)</script><h1>Leave</h1><p>Annual leave is 25&nbsp;days &amp; more.</p>
       <!-- hidden --><ul><li>Sick&#39;s note</li></ul></body></html>`
    );
    expect(page.title).toBe('Leave policy');
    expect(page.text).not.toMatch(/alert|color|hidden|</);
    expect(page.text).toContain('Annual leave is 25 days & more.');
    expect(page.text).toContain("Sick's note");
    expect(page.text.split('\n\n')).toContain('Leave');
  });

  it('detects markdown by headings or fences', () => {
    expect(looksMarkdown('# Title\ntext')).toBe(true);
    expect(looksMarkdown('```\ncode\n```')).toBe(true);
    expect(looksMarkdown('Just text. #hashtag')).toBe(false);
  });

  it('reads cells as text', () => {
    expect(cellText(['a', { title: 'Linked' }, null])).toBe('a, Linked');
    expect(cellText({ name: 'Ada' })).toBe('Ada');
    expect(cellText(42)).toBe('42');
    expect(cellText(undefined)).toBe('');
  });

  it('derives source refs from the source, not the name', () => {
    expect(sourceRefOf({ kind: 'text', text: 'x', slug: 'handbook' })).toBe('text:handbook');
    expect(sourceRefOf({ kind: 'text', text: 'x' })).toMatch(/^text:[0-9a-f]{16}$/);
    expect(sourceRefOf({ kind: 'url', url: 'HTTPS://Example.com/a?b=1' })).toBe(
      'url:https://example.com/a?b=1'
    );
    expect(sourceRefOf({ kind: 'record', baseId: 'bse1', tableId: 'tbl1', recordId: 'rec1' })).toBe(
      'record:bse1/tbl1/rec1'
    );
    expect(sourceRefOf({ kind: 'attachment', token: 'tok' })).toBe('attachment:tok');
  });
});
