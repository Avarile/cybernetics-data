import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DATA_GATEWAY_PORT, type IDataGatewayPort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

const baseId = z.string().startsWith('bse').describe('base id (bse…)');
const table = z.string().min(1).describe('table id (tbl…) or exact table name');
const filterHelp =
  'Teable filter: {conjunction:"and"|"or", filterSet:[{fieldId:<field name or id>, operator, value}]}. Operators include is, isNot, contains, doesNotContain, isGreater, isLess, isEmpty, isNotEmpty, isAnyOf.';

/** Reading data in every space and base (design §8 data_read). Results are untrusted data. */
@Injectable()
export class DataReadToolkit implements IToolkit, OnModuleInit {
  readonly id = 'data_read' as const;
  readonly title = 'Read data';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(DATA_GATEWAY_PORT) private readonly data: IDataGatewayPort
  ) {
    this.tools = [
      defineTool({
        name: 'list_spaces',
        description: 'List every space in the instance.',
        input: z.object({}),
        untrusted: true,
        execute: async () => ({ spaces: await this.data.listSpaces() }),
      }),
      defineTool({
        name: 'list_bases',
        description: 'List bases, optionally of one space.',
        input: z.object({ spaceId: z.string().startsWith('spc').optional() }),
        untrusted: true,
        execute: async ({ spaceId }) => ({ bases: await this.data.listBases(spaceId) }),
      }),
      defineTool({
        name: 'list_tables',
        description: 'List the tables of a base.',
        input: z.object({ baseId }),
        untrusted: true,
        execute: async (i) => ({ tables: await this.data.listTables(i.baseId) }),
      }),
      defineTool({
        name: 'describe_table',
        description:
          'Fields of a table: names, types, select choices, links. Read this before querying.',
        input: z.object({ baseId, table }),
        untrusted: true,
        execute: (i) => this.data.describeTable(i),
      }),
      defineTool({
        name: 'query_records',
        description: `Read records of a table, keyed by field name. ${filterHelp} Page with skip while hasMore is true.`,
        input: z.object({
          baseId,
          table,
          filter: z.record(z.string(), z.unknown()).optional(),
          orderBy: z
            .array(z.object({ field: z.string(), order: z.enum(['asc', 'desc']) }))
            .max(5)
            .optional(),
          search: z.string().max(200).optional(),
          fields: z.array(z.string()).max(50).optional().describe('field names to return'),
          take: z.number().int().min(1).max(100).optional(),
          skip: z.number().int().min(0).optional(),
          includeDeleted: z.boolean().optional(),
        }),
        untrusted: true,
        execute: (i) => this.data.queryRecords(i),
      }),
      defineTool({
        name: 'get_records',
        description: 'Read specific records by id (at most 100).',
        input: z.object({
          baseId,
          table,
          recordIds: z.array(z.string().startsWith('rec')).min(1).max(100),
        }),
        untrusted: true,
        execute: (i) => this.data.getRecords(i),
      }),
      defineTool({
        name: 'aggregate',
        description: `Count rows and compute statistics (sum, average, min, max, unique, filled, empty, …) per field, optionally over a filter. ${filterHelp}`,
        input: z.object({
          baseId,
          table,
          metrics: z
            .array(z.object({ field: z.string(), func: z.string() }))
            .max(20)
            .default([]),
          filter: z.record(z.string(), z.unknown()).optional(),
        }),
        untrusted: true,
        execute: (i) => this.data.aggregate(i),
      }),
      defineTool({
        name: 'search_everywhere',
        description:
          'Find spaces, bases and tables by name across the instance; with baseId, also matching rows in that base.',
        input: z.object({
          query: z.string().min(1).max(200),
          baseId: baseId.optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
        untrusted: true,
        execute: ({ query, ...options }) => this.data.searchEverywhere(query, options),
      }),
    ];
  }

  onModuleInit() {
    this.registry.register(this);
  }
}
