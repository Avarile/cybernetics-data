/* eslint-disable sonarjs/no-duplicate-string */
import type { ISchemaField } from '../search/schema';
import { MASK, recordMarkdown } from './record-markdown';
import { snippetOf } from './snippet';
import { spokenText, summaryPrompt, SUMMARY_INPUT_MAX } from './summary-prompt';

const fields: ISchemaField[] = [
  { id: 'fTitle', name: 'title', type: 'singleLineText', isPrimary: true },
  { id: 'fStatus', name: 'Status', type: 'singleSelect' },
  { id: 'fBody', name: 'context', type: 'longText' },
  { id: 'fPass', name: 'password', type: 'singleLineText' },
  { id: 'fFiles', name: 'Files', type: 'attachment' },
  { id: 'fNo', name: 'No', type: 'autoNumber' },
  { id: 'fUpdated', name: 'updated_at', type: 'lastModifiedTime' },
  { id: 'fNote', name: 'Note | short', type: 'singleLineText' },
];

describe('recordMarkdown', () => {
  it('writes the title, short values as a table and long text as sections', () => {
    const md = recordMarkdown(
      { name: 'knowledges', fields },
      {
        fTitle: 'Deploy K3s',
        fStatus: 'Done',
        fBody: '## Steps\n\n1. pull\n2. apply',
        fPass: 'hunter2',
        fFiles: 'notes.pdf (https://files.example/notes.pdf)',
        fNo: '12',
        fUpdated: '2026-10-30T14:02:11.000Z',
        fNote: 'a|b',
      },
      '2026-10-30T14:02:11.000Z'
    );
    expect(md.title).toBe('Deploy K3s');
    expect(md.masked).toEqual(['password']);
    expect(md.markdown).toBe(
      [
        '# Deploy K3s',
        '',
        '`knowledges` · updated 2026-10-30 14:02 UTC',
        '',
        '| Field | Value |',
        '| --- | --- |',
        '| Status | Done |',
        `| password | ${MASK} |`,
        '| Files | notes.pdf |',
        '| Note \\| short | a\\|b |',
        '',
        '## context',
        '',
        '## Steps\n\n1. pull\n2. apply',
        '',
      ].join('\n')
    );
    expect(md.markdown).not.toMatch(/hunter2|https:/);
    // title + Done + the context + notes.pdf + a|b; the masked value and bookkeeping left out
    expect(md.chars).toBe(10 + 4 + 26 + 9 + 3);
  });

  it('names an untitled record', () => {
    expect(recordMarkdown({ name: 't', fields }, {}).title).toBe('(untitled)');
  });
});

describe('snippetOf', () => {
  const long = `${'x'.repeat(100)} deployment notes ${'y'.repeat(100)}`;

  it('cuts the first matching field around the match, title and secrets skipped', () => {
    const s = snippetOf(fields, { fTitle: 'deploy', fPass: 'deploy', fBody: long }, 'DEPLOY')!;
    expect(s.field).toBe('context');
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    expect(s.text.slice(s.match[0], s.match[1])).toBe('deploy');
  });

  it('is null when only the title matched', () => {
    expect(snippetOf(fields, { fTitle: 'deploy', fStatus: 'Done' }, 'deploy')).toBeNull();
  });

  it('keeps a short value whole', () => {
    expect(snippetOf(fields, { fStatus: 'In progress' }, 'progress')).toEqual({
      field: 'Status',
      text: 'In progress',
      match: [3, 11],
    });
  });
});

describe('summary prompt', () => {
  it('caps the record and speaks one paragraph', () => {
    expect(summaryPrompt('a'.repeat(SUMMARY_INPUT_MAX + 5))).toHaveLength(SUMMARY_INPUT_MAX + 1);
    expect(spokenText('**Deploy** notes.\n\n- `k3s` #ops')).toBe('Deploy notes. - k3s ops');
  });
});
