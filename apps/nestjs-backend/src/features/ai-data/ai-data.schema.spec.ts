/* eslint-disable @typescript-eslint/no-explicit-any, sonarjs/no-duplicate-string */
import { SortFunc } from '@teable/core';
import { describe, expect, it } from 'vitest';
import {
  detectTableProfile,
  keyRecordsByName,
  resolveFieldRef,
  translateFilter,
  translateOrderBy,
  withSoftDeleteFilter,
} from './ai-data.schema';
import type { IAiDataFieldSummary } from './ai-data.schema';

const f = (id: string, name: string, type = 'singleLineText', extra = {}) =>
  ({ id, name, type, isPrimary: false, isComputed: false, ...extra }) as IAiDataFieldSummary;

const fields = [
  f('fldT', 'title', 'singleLineText', { isPrimary: true }),
  f('fldC', 'context', 'longText'),
  f('fldD', 'deleted_at', 'date'),
  f('fldE', 'Email'),
  f('fldE2', 'email'),
  f('fldS', 'Status', 'singleSelect'),
];

describe('detectTableProfile', () => {
  it('finds title, context and soft-delete fields by convention', () => {
    expect(detectTableProfile(fields)).toEqual({
      titleFieldId: 'fldT',
      contextFieldId: 'fldC',
      softDeleteFieldId: 'fldD',
    });
  });

  it('ignores look-alikes with the wrong type or computed values', () => {
    expect(
      detectTableProfile([
        f('fldT', 'Name', 'singleLineText', { isPrimary: true }),
        f('fldD', 'deleted_at', 'singleLineText'),
        f('fldC', 'context', 'formula', { isComputed: true }),
      ])
    ).toEqual({ titleFieldId: 'fldT' });
  });
});

describe('resolveFieldRef', () => {
  it('accepts ids, exact names, and unambiguous case-insensitive names', () => {
    expect(resolveFieldRef('fldS', fields, 'T')).toBe('fldS');
    expect(resolveFieldRef('Status', fields, 'T')).toBe('fldS');
    expect(resolveFieldRef('status', fields, 'T')).toBe('fldS');
    expect(resolveFieldRef('Email', fields, 'T')).toBe('fldE');
    expect(resolveFieldRef('email', fields, 'T')).toBe('fldE2');
  });

  it('refuses ambiguous and unknown names with a helpful message', () => {
    expect(() => resolveFieldRef('EMAIL', fields, 'Contacts')).toThrow(
      /Unknown field "EMAIL" in table "Contacts". Fields: title, context, deleted_at, Email, email/
    );
    expect(() => resolveFieldRef('nope', fields, 'T')).toThrow(/Unknown field "nope"/);
  });
});

describe('translateFilter / translateOrderBy', () => {
  it('rewrites nested items and field-valued operands, leaving everything else alone', () => {
    const filter = {
      conjunction: 'and',
      filterSet: [
        { fieldId: 'title', operator: 'contains', value: 'x' },
        {
          conjunction: 'or',
          filterSet: [
            { fieldId: 'Status', operator: 'is', value: 'Open' },
            { fieldId: 'context', operator: 'is', value: { type: 'field', fieldId: 'title' } },
          ],
        },
      ],
    } as any;
    expect(translateFilter(filter, fields, 'T')).toEqual({
      conjunction: 'and',
      filterSet: [
        { fieldId: 'fldT', operator: 'contains', value: 'x' },
        {
          conjunction: 'or',
          filterSet: [
            { fieldId: 'fldS', operator: 'is', value: 'Open' },
            { fieldId: 'fldC', operator: 'is', value: { type: 'field', fieldId: 'fldT' } },
          ],
        },
      ],
    });
  });

  it('throws on an unknown field anywhere in the tree', () => {
    const filter = {
      conjunction: 'and',
      filterSet: [{ conjunction: 'or', filterSet: [{ fieldId: 'ghost', operator: 'is' }] }],
    } as any;
    expect(() => translateFilter(filter, fields, 'T')).toThrow(/Unknown field "ghost"/);
  });

  it('rewrites sort items', () => {
    expect(translateOrderBy([{ fieldId: 'title', order: SortFunc.Asc }], fields, 'T')).toEqual([
      { fieldId: 'fldT', order: 'asc' },
    ]);
  });
});

describe('withSoftDeleteFilter', () => {
  it('adds the condition on its own or alongside an existing filter', () => {
    const notDeleted = { fieldId: 'fldD', operator: 'isEmpty', value: null };
    expect(withSoftDeleteFilter(undefined, 'fldD')).toEqual({
      conjunction: 'and',
      filterSet: [notDeleted],
    });
    const own = { conjunction: 'or', filterSet: [{ fieldId: 'fldT', operator: 'is', value: 'a' }] };
    expect(withSoftDeleteFilter(own as any, 'fldD')).toEqual({
      conjunction: 'and',
      filterSet: [own, notDeleted],
    });
  });
});

describe('keyRecordsByName', () => {
  it('maps known ids to names and leaves unknown keys as they are', () => {
    expect(keyRecordsByName([{ id: 'rec1', fields: { fldT: 'Hello', fldX: 1 } }], fields)).toEqual([
      { id: 'rec1', fields: { title: 'Hello', fldX: 1 } },
    ]);
  });
});
