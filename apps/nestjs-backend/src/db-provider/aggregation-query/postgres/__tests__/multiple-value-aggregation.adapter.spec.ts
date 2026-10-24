import type { FieldCore } from '@cybernetics/core';
import { FieldType } from '@cybernetics/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import type { IRecordQueryAggregateContext } from '../../../../features/record/query-builder/record-query-builder.interface';
import { MultipleValueAggregationAdapter } from '../multiple-value/multiple-value-aggregation.adapter';

const knexClient = knex({ client: 'pg' });

const createAdapter = () => {
  const field = {
    id: 'fldNumericArray',
    dbFieldName: '"values"',
    isMultipleCellValue: true,
    type: FieldType.Number,
  } as unknown as FieldCore;

  const context: IRecordQueryAggregateContext = {
    selectionMap: new Map([[field.id, '"alias"."values"']]),
    tableDbName: 'public.test_table',
    tableAlias: 'alias',
  };

  return new MultipleValueAggregationAdapter(knexClient, field, context);
};

describe('MultipleValueAggregationAdapter numeric coercion', () => {
  it.each([
    ['sum', (adapter: MultipleValueAggregationAdapter) => adapter.sum()],
    ['average', (adapter: MultipleValueAggregationAdapter) => adapter.average()],
    ['max', (adapter: MultipleValueAggregationAdapter) => adapter.max()],
    ['min', (adapter: MultipleValueAggregationAdapter) => adapter.min()],
  ])('renders %s aggregation without integer casts', (_, getSql) => {
    const adapter = createAdapter();
    const sql = getSql(adapter);
    expect(sql).toContain('::double precision');
    expect(sql).toContain('REGEXP_REPLACE');
    expect(sql.toUpperCase()).not.toContain('::INTEGER');
  });
});
