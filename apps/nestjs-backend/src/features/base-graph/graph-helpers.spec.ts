/* eslint-disable @typescript-eslint/naming-convention */
import { FieldType } from '@teable/core';
import type { IFieldInstance } from '../field/model/factory';
import { collectNeighbours, detailFieldOrder } from './graph-node.service';
import { labelOf, toGraphRow } from './graph-row.reader';

const field = (id: string, extra: Partial<IFieldInstance> = {}) =>
  ({
    id,
    name: id,
    type: FieldType.SingleLineText,
    cellValue2String: (v: unknown) => `str(${String(v)})`,
    ...extra,
  }) as unknown as IFieldInstance;

describe('labelOf', () => {
  it('renders through the field, and treats a missing cell as empty', () => {
    expect(labelOf(field('fldA'), 42)).toBe('str(42)');
    expect(labelOf(field('fldA'), undefined)).toBe('');
  });

  it('falls back to a raw string when rendering throws', () => {
    const broken = field('fldA', {
      cellValue2String: () => {
        throw new Error('boom');
      },
    } as unknown as Partial<IFieldInstance>);
    expect(labelOf(broken, 'raw')).toBe('raw');
    expect(labelOf(broken, { x: 1 })).toBe('');
  });
});

describe('toGraphRow', () => {
  const plan = {
    primaryField: field('fldName'),
    hierarchyField: field('fldParent'),
    groupField: field('fldGroup'),
    readFields: [field('fldTags')],
  };

  it('reads label, hierarchy parent, group and link targets', () => {
    expect(
      toGraphRow(plan, {
        id: 'recA',
        fields: {
          fldName: 'A',
          fldParent: { id: 'recP', title: 'P' },
          fldGroup: { id: 'recG', title: 'Group' },
          fldTags: [{ id: 'recT1' }, { id: 'recT2' }],
        },
      })
    ).toEqual({
      recordId: 'recA',
      title: 'str(A)',
      parentRecordId: 'recP',
      group: { recordId: 'recG', title: 'Group' },
      links: [{ fieldId: 'fldTags', targetRecordIds: ['recT1', 'recT2'] }],
    });
  });

  it('tolerates absent cells', () => {
    expect(toGraphRow(plan, { id: 'recA', fields: {} })).toEqual({
      recordId: 'recA',
      title: '',
      parentRecordId: null,
      group: null,
      links: [{ fieldId: 'fldTags', targetRecordIds: [] }],
    });
  });
});

describe('detailFieldOrder', () => {
  it('puts the primary first, then visible fields in view order', () => {
    const fields = [
      field('fldB'),
      field('fldP', { isPrimary: true }),
      field('fldA'),
      field('fldH'),
    ];
    const order = detailFieldOrder(fields, {
      fldA: { order: 1 },
      fldB: { order: 2 },
      fldH: { order: 0, hidden: true },
    });
    expect(order.map((f) => f.id)).toEqual(['fldP', 'fldA', 'fldB']);
  });
});

describe('collectNeighbours', () => {
  const cells = [
    { fieldId: 'fldX', foreignTableId: 'tblX', targets: ['recSeed', 'rec1', 'rec2', 'rec3'] },
    { fieldId: 'fldY', foreignTableId: 'tblY', targets: ['rec1', 'rec9'] },
  ];

  it('skips the seed, fetches each new record once, keeps every edge', () => {
    const out = collectNeighbours('recSeed', cells, new Set(), 10);
    expect(Object.fromEntries(out.toFetch)).toEqual({
      tblX: ['rec1', 'rec2', 'rec3'],
      tblY: ['rec9'],
    });
    expect(out.edges).toHaveLength(5);
    expect(out.truncated).toBe(false);
  });

  it('does not refetch what the client holds, and honours the limit', () => {
    const out = collectNeighbours('recSeed', cells, new Set(['rec:rec2']), 2);
    expect(Object.fromEntries(out.toFetch)).toEqual({ tblX: ['rec1', 'rec3'] });
    expect(out.edges.map((e) => e.other)).toEqual(['rec1', 'rec2', 'rec3', 'rec1']);
    expect(out.truncated).toBe(true);
  });
});
