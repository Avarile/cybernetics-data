import { FieldType, Relationship } from '@teable/core';
import { schemaPackInstallRoSchema } from './install';
import { schemaPackFieldSchema, schemaPackSchema } from './types';

const samplePack = {
  id: 'progress',
  version: 1,
  tables: [
    {
      key: 'projects',
      name: 'projects',
      fields: [
        { key: 'title', name: 'title', type: FieldType.SingleLineText, isPrimary: true },
        {
          key: 'tasks',
          name: 'tasks',
          type: FieldType.Link,
          link: {
            table: 'tasks',
            relationship: Relationship.OneMany,
            symmetric: { key: 'belong_project', name: 'belong_project' },
          },
        },
      ],
    },
  ],
};

describe('schema pack spec', () => {
  it('parses a valid pack', () => {
    expect(schemaPackSchema.parse(samplePack).tables[0].fields).toHaveLength(2);
  });

  it('rejects unknown keys', () => {
    const bad = { ...samplePack, extra: true };
    expect(schemaPackSchema.safeParse(bad).success).toBe(false);
    const badField = { key: 'a', name: 'a', type: FieldType.Number, fieldId: 'fldX' };
    expect(schemaPackFieldSchema.safeParse(badField).success).toBe(false);
  });

  it('requires link options on link fields and a source on rollups', () => {
    expect(
      schemaPackFieldSchema.safeParse({ key: 'l', name: 'l', type: FieldType.Link }).success
    ).toBe(false);
    expect(
      schemaPackFieldSchema.safeParse({ key: 'r', name: 'r', type: FieldType.Rollup }).success
    ).toBe(false);
  });

  it('rejects keys that are not identifiers', () => {
    const field = { key: 'has space', name: 'x', type: FieldType.Number };
    expect(schemaPackFieldSchema.safeParse(field).success).toBe(false);
  });
});

describe('install request', () => {
  const valid = {
    spaceId: 'spcAbc',
    packs: ['progress', 'people'],
    options: {
      baseName: 'My data centre',
      timezone: 'Australia/Melbourne',
      currency: 'AUD',
      starterRows: true,
      optionalTables: [],
    },
  };

  it('accepts a valid request', () => {
    expect(schemaPackInstallRoSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['duplicate packs', { ...valid, packs: ['progress', 'progress'] }],
    ['unknown pack', { ...valid, packs: ['crm'] }],
    ['no packs', { ...valid, packs: [] }],
    ['bad timezone', { ...valid, options: { ...valid.options, timezone: 'Mars/Olympus' } }],
    ['bad currency', { ...valid, options: { ...valid.options, currency: 'BTC' } }],
    ['blank base name', { ...valid, options: { ...valid.options, baseName: '   ' } }],
    ['unknown option', { ...valid, options: { ...valid.options, admin: true } }],
  ])('rejects %s', (_label, ro) => {
    expect(schemaPackInstallRoSchema.safeParse(ro).success).toBe(false);
  });
});
