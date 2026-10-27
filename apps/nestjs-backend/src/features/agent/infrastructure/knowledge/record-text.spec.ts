import { detectTableProfile } from '../../../ai-data/ai-data.schema';
import { MAX_VALUE_CHARS, recordText } from './record-text';

const field = (id: string, name: string, type: string, isPrimary = false) => ({
  id,
  name,
  type,
  isPrimary,
  isComputed: false,
});

describe('recordText', () => {
  const projects = [
    field('fldName', 'Name', 'singleLineText', true),
    field('fldStatus', 'Status', 'singleSelect'),
    field('fldBudget', 'Budget', 'number'),
    field('fldDue', 'Due', 'date'),
    field('fldClient', 'Client', 'link'),
    field('fldFiles', 'Files', 'attachment'),
    field('fldNo', 'No', 'autoNumber'),
    field('fldBy', 'Created by', 'createdBy'),
    field('fldEmpty', 'Notes', 'longText'),
  ];
  const cells = {
    fldName: 'Apollo rollout',
    fldStatus: 'Active',
    fldBudget: '$12,000.00',
    fldDue: '2026-11-30',
    fldClient: 'Acme Pty Ltd',
    fldFiles: 'plan.pdf',
    fldNo: '7',
    fldBy: 'Dana',
    fldEmpty: '',
  };

  it('reads every field of an ordinary table by name, without bookkeeping fields', () => {
    expect(recordText(projects, detectTableProfile(projects), cells, 'records')).toEqual({
      title: 'Apollo rollout',
      text: [
        'Status: Active',
        'Budget: $12,000.00',
        'Due: 2026-11-30',
        'Client: Acme Pty Ltd',
        'Files: plan.pdf',
      ].join('\n\n'),
      format: 'record',
    });
  });

  it('reads a knowledge table from its context field', () => {
    const kb = [
      field('fldTitle', 'title', 'singleLineText', true),
      field('fldContext', 'context', 'longText'),
      field('fldTag', 'tag', 'singleSelect'),
    ];
    const cellsKb = { fldTitle: 'VPN setup', fldContext: 'Install the client.', fldTag: 'it' };
    expect(recordText(kb, detectTableProfile(kb), cellsKb, 'knowledge')).toEqual({
      title: 'VPN setup',
      text: 'Install the client.',
      format: 'record',
    });
  });

  it('treats a record with deleted_at as gone, and cuts very long values', () => {
    const withDelete = [...projects, field('fldDel', 'deleted_at', 'date')];
    const profile = detectTableProfile(withDelete);
    expect(recordText(withDelete, profile, { ...cells, fldDel: '2026-10-01' }, 'records')).toBe(
      undefined
    );
    const long = recordText(
      projects,
      profile,
      { ...cells, fldStatus: 'x'.repeat(30_000) },
      'records'
    );
    expect(long!.text.split('\n\n')[0].length).toBeLessThanOrEqual(MAX_VALUE_CHARS + 10);
  });
});
