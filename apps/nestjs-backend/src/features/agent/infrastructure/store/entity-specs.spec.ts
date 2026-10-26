import { messageSummary } from './agent-table-store';
import { bool, lines, ref, refs, strings } from './codecs';
import { memorySpec, projectionOf, readEntity, writeEntity } from './entity-specs';

const fieldIds = Object.fromEntries(
  Object.values(memorySpec.fields).map(([packKey]) => [packKey, `fld_${packKey}`])
);

describe('codecs', () => {
  it('read forgivingly and write what the record API takes', () => {
    expect(bool.read(null)).toBe(false);
    expect(bool.write(false)).toBeNull();
    expect(strings.read('one')).toEqual(['one']);
    expect(strings.write([])).toBeNull();
    expect(lines.read('api.github.com\r\n\n  uploads.github.com ')).toEqual([
      'api.github.com',
      'uploads.github.com',
    ]);
    expect(ref.read([{ id: 'rec1', title: 'x' }])).toBe('rec1');
    expect(ref.write('rec1')).toEqual({ id: 'rec1' });
    expect(refs.read({ id: 'rec1' })).toEqual(['rec1']);
    expect(refs.write(['a', 'b'])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('entity mapping', () => {
  it('reads a record into a memory, with empty cells as defaults', () => {
    const memory = readEntity(memorySpec, fieldIds, {
      id: 'recM',
      fields: {
        fld_title: 'Prefers metric units',
        fld_pinned: true,
        fld_tags: ['units'],
        fld_source_thread: { id: 'recT', title: 'chat' },
      },
    });
    expect(memory).toMatchObject({
      id: 'recM',
      title: 'Prefers metric units',
      pinned: true,
      isActive: false,
      tags: ['units'],
      sourceThreadId: 'recT',
      content: null,
    });
  });

  it('writes by field id, skipping computed fields and undefined values', () => {
    const cells = writeEntity(memorySpec, fieldIds, {
      title: 't',
      pinned: false,
      createdAt: '2026-01-01',
      content: undefined,
      sourceThreadId: 'recT',
    });
    expect(cells).toEqual({
      fld_title: 't',
      fld_pinned: null,
      fld_source_thread: { id: 'recT' },
    });
  });

  it('refuses to write a field the table no longer has', () => {
    const { content: _content, ...rest } = fieldIds;
    void _content;
    expect(() => writeEntity(memorySpec, rest, { content: 'x' })).toThrow(/content/);
    expect(projectionOf(memorySpec, rest)).not.toContain('fld_content');
  });

  it('summarises a message from its text, else its role', () => {
    expect(messageSummary({ role: 'user', content: '  hello\n\nworld ' })).toBe('hello world');
    expect(messageSummary({ role: 'tool', content: null })).toBe('tool');
    expect(messageSummary({ role: 'user', content: 'x'.repeat(300) })).toHaveLength(100);
  });
});
