import { FieldType } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BULK_WRITE_THRESHOLD } from '../../domain/policies/approval-policy';
import { DATA_GATEWAY_PORT, type IDataGatewayPort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

/** Design §9.3: at most this many records per write call. */
export const MAX_RECORDS_PER_WRITE = 100;

const baseId = z.string().startsWith('bse').describe('base id (bse…)');
const table = z.string().min(1).describe('table id (tbl…) or exact table name');
const cells = z.record(z.string(), z.unknown()).describe('cell values keyed by field name');
const fieldSpec = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(Object.values(FieldType) as [string, ...string[]]),
  options: z.record(z.string(), z.unknown()).optional(),
  description: z.string().max(2000).nullable().optional(),
});
const bulk = (n: number) => n > BULK_WRITE_THRESHOLD;

/** create/update/delete records anywhere (design §8 data_write). */
@Injectable()
export class DataWriteToolkit implements IToolkit, OnModuleInit {
  readonly id = 'data_write' as const;
  readonly title = 'Change records';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(DATA_GATEWAY_PORT) private readonly data: IDataGatewayPort
  ) {
    this.tools = [
      defineTool({
        name: 'create_records',
        description: `Create records (at most ${MAX_RECORDS_PER_WRITE}); values are converted to the field types.`,
        input: z.object({
          baseId,
          table,
          records: z.array(cells).min(1).max(MAX_RECORDS_PER_WRITE),
        }),
        approval: { category: 'bulk_write', when: (i) => bulk(i.records.length) },
        execute: (i) => this.data.createRecords(i),
      }),
      defineTool({
        name: 'update_records',
        description: `Change cells of records by id (at most ${MAX_RECORDS_PER_WRITE}); only the fields you send change.`,
        input: z.object({
          baseId,
          table,
          records: z
            .array(z.object({ id: z.string().startsWith('rec'), fields: cells }))
            .min(1)
            .max(MAX_RECORDS_PER_WRITE),
        }),
        approval: { category: 'bulk_write', when: (i) => bulk(i.records.length) },
        execute: (i) => this.data.updateRecords(i),
      }),
      defineTool({
        name: 'delete_records',
        description: `Delete records by id (at most ${MAX_RECORDS_PER_WRITE}); they go to the trash.`,
        input: z.object({
          baseId,
          table,
          recordIds: z.array(z.string().startsWith('rec')).min(1).max(MAX_RECORDS_PER_WRITE),
        }),
        approval: { category: 'delete_records' },
        execute: (i) => this.data.deleteRecords(i),
      }),
    ];
  }

  onModuleInit() {
    this.registry.register(this);
  }
}

/** Tables and fields anywhere (design §8 schema). Every change asks; deletes always ask. */
@Injectable()
export class SchemaToolkit implements IToolkit, OnModuleInit {
  readonly id = 'schema' as const;
  readonly title = 'Change tables and fields';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(DATA_GATEWAY_PORT) private readonly data: IDataGatewayPort
  ) {
    this.tools = [
      defineTool({
        name: 'create_table',
        description: 'Create a table with fields (Teable field types and options).',
        input: z.object({
          baseId,
          name: z.string().min(1).max(255),
          fields: z.array(fieldSpec).max(50).default([]),
        }),
        approval: { category: 'schema_change' },
        execute: (i) => this.data.createTable(i),
      }),
      defineTool({
        name: 'create_field',
        description: 'Add a field to a table.',
        input: z.object({ baseId, table, field: fieldSpec }),
        approval: { category: 'schema_change' },
        execute: (i) => this.data.createField(i),
      }),
      defineTool({
        name: 'update_field',
        description: 'Rename or describe a field; a new type or new options convert its values.',
        input: z.object({
          baseId,
          table,
          field: z.string().min(1).describe('field name or id'),
          patch: fieldSpec.partial().refine((p) => Object.keys(p).length > 0, 'nothing to change'),
        }),
        approval: { category: 'schema_change' },
        execute: (i) => this.data.updateField(i),
      }),
      defineTool({
        name: 'delete_field',
        description: 'Delete a field (it goes to the trash with the table history).',
        input: z.object({ baseId, table, field: z.string().min(1) }),
        approval: { category: 'delete_schema', always: true },
        execute: (i) => this.data.deleteField(i),
      }),
      defineTool({
        name: 'delete_table',
        description: 'Delete a table; it goes to the trash.',
        input: z.object({ baseId, table }),
        approval: { category: 'delete_schema', always: true },
        execute: (i) => this.data.deleteTable(i),
      }),
    ];
  }

  onModuleInit() {
    this.registry.register(this);
  }
}
