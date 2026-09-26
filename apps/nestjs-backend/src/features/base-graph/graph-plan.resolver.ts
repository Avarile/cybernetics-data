import { Injectable } from '@nestjs/common';
import type { IFilter, ILinkFieldOptions } from '@teable/core';
import { extractFieldIdsFromFilter, FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseGraphQueryRo } from '@teable/openapi';
// A value import: IBaseGraphConfig is referenced from a decorated constructor
// parameter, so it must survive into decorator metadata.
import { BaseGraphConfig, IBaseGraphConfig } from '../../configs/base-graph.config';
import { CustomHttpException } from '../../custom.exception';
import type { IFieldInstance } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import type { IAssemblerPlan, IAssemblerTable } from './assembler';

export interface IGraphTablePlan extends IAssemblerTable {
  primaryField: IFieldInstance;
  hierarchyField: IFieldInstance | null;
  groupField: IFieldInstance | null;
  /** Edge fields whose cells are read — one side of each two-way pair. */
  readFields: IFieldInstance[];
  viewId?: string;
  filter?: IFilter;
  limit: number;
  /**
   * Every value the payload depends on lives in a stored column of this table,
   * so a row-level aggregate sees every change. False when a used field, or a
   * field the filters test, is computed: a formula or lookup can change without
   * its row being written.
   */
  probeSafe: boolean;
}

export interface IGraphPlan {
  baseId: string;
  tables: IGraphTablePlan[];
  assembler: IAssemblerPlan;
}

export interface ITableMetaLite {
  id: string;
  name: string;
}

export interface IResolverInput {
  baseId: string;
  ro: IBaseGraphQueryRo;
  /** Only tables that exist, are not deleted, and belong to `baseId`. */
  tables: ITableMetaLite[];
  fieldsByTable: ReadonlyMap<string, IFieldInstance[]>;
  viewIdsByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Field ids each view's own filter tests, keyed by view id. */
  viewFilterFieldIds?: ReadonlyMap<string, readonly string[]>;
  config: IBaseGraphConfig;
  labels: { base: string; unclassified: string };
}

const badRequest = (message: string) =>
  new CustomHttpException(message, HttpErrorCode.VALIDATION_ERROR);

/** A real Link column — a lookup of a link has type Link too, but is derived. */
export const isRealLinkField = (field: IFieldInstance): boolean =>
  field.type === FieldType.Link && !field.isLookup && !field.isConditionalLookup;

export const linkOptionsOf = (field: IFieldInstance): ILinkFieldOptions =>
  field.options as ILinkFieldOptions;

/** A link into another base; following it would need that base's permission. */
export const isCrossBaseLink = (field: IFieldInstance, baseId: string): boolean => {
  const target = linkOptionsOf(field).baseId;
  return Boolean(target && target !== baseId);
};

const findField = (fields: IFieldInstance[], fieldId: string, tableId: string, role: string) => {
  const field = fields.find((f) => f.id === fieldId);
  if (!field) {
    throw badRequest(`${role} field ${fieldId} is not a field of table ${tableId}`);
  }
  if (!isRealLinkField(field)) {
    throw badRequest(`${role} field "${field.name}" on table ${tableId} must be a Link field`);
  }
  if (field.isMultipleCellValue) {
    throw badRequest(
      `${role} field "${field.name}" on table ${tableId} is multi-valued; a record has exactly one parent`
    );
  }
  return field;
};

const assertNoGroupCycle = (tables: IGraphTablePlan[]) => {
  const next = new Map(tables.map((t) => [t.tableId, t.groupTargetTableId]));
  for (const start of tables) {
    const seen = new Set<string>([start.tableId]);
    let current = next.get(start.tableId) ?? null;
    while (current) {
      if (seen.has(current)) {
        throw badRequest(`Group fields form a cycle through table ${current}`);
      }
      seen.add(current);
      current = next.get(current) ?? null;
    }
  }
};

type ITableRo = IBaseGraphQueryRo['tables'][number];

const assertViewAndFilter = (input: IResolverInput, t: ITableRo, fields: IFieldInstance[]) => {
  if (t.viewId && !input.viewIdsByTable.get(t.tableId)?.has(t.viewId)) {
    throw badRequest(`View ${t.viewId} is not a view of table ${t.tableId}`);
  }
  if (!t.filter) {
    return;
  }
  const known = new Set(fields.map((f) => f.id));
  const unknown = extractFieldIdsFromFilter(t.filter, true).filter((id) => !known.has(id));
  if (unknown.length) {
    throw badRequest(
      `Filter on table ${t.tableId} references unknown fields: ${unknown.join(', ')}`
    );
  }
};

const hierarchyFieldOf = (fields: IFieldInstance[], fieldId: string, tableId: string) => {
  const field = findField(fields, fieldId, tableId, 'Hierarchy');
  if (linkOptionsOf(field).foreignTableId !== tableId) {
    throw badRequest(`Hierarchy field "${field.name}" must link the table to itself`);
  }
  return field;
};

const groupFieldOf = (
  fields: IFieldInstance[],
  fieldId: string,
  tableId: string,
  baseId: string
) => {
  const field = findField(fields, fieldId, tableId, 'Group');
  if (linkOptionsOf(field).foreignTableId === tableId) {
    throw badRequest(`Group field "${field.name}" must link to another table`);
  }
  if (isCrossBaseLink(field, baseId)) {
    throw badRequest(`Group field "${field.name}" links into another base`);
  }
  return field;
};

const resolveTable = (
  input: IResolverInput,
  t: ITableRo,
  name: string,
  included: ReadonlySet<string>,
  maxNodes: number
): IGraphTablePlan => {
  const { baseId, config } = input;
  const fields = input.fieldsByTable.get(t.tableId) ?? [];

  const primaryField = fields.find((f) => f.isPrimary);
  if (!primaryField) {
    throw new CustomHttpException(
      `Table ${t.tableId} has no primary field`,
      HttpErrorCode.NOT_FOUND
    );
  }

  assertViewAndFilter(input, t, fields);

  const hierarchyField = t.hierarchyFieldId
    ? hierarchyFieldOf(fields, t.hierarchyFieldId, t.tableId)
    : null;
  const groupField = t.groupByFieldId
    ? groupFieldOf(fields, t.groupByFieldId, t.tableId, baseId)
    : null;
  const groupTarget = groupField ? linkOptionsOf(groupField).foreignTableId : null;

  return {
    tableId: t.tableId,
    name,
    hierarchyFieldId: hierarchyField?.id ?? null,
    groupFieldId: groupField?.id ?? null,
    groupTargetTableId: groupTarget && included.has(groupTarget) ? groupTarget : null,
    edgeFields: [],
    primaryField,
    hierarchyField,
    groupField,
    readFields: [],
    viewId: t.viewId,
    filter: t.filter ?? undefined,
    limit: Math.min(t.limit ?? config.defaultTableLimit, maxNodes),
    probeSafe: true,
  };
};

/**
 * Link fields drawn as edges: real links between included tables, same base,
 * not structural (hierarchy/group) and not the symmetric twin of a structural
 * field — that twin would redraw the tree as link edges.
 */
const structuralFieldIds = (plans: IGraphTablePlan[]): Set<string> => {
  const structural = new Set<string>();
  for (const f of plans.flatMap((p) => [p.hierarchyField, p.groupField])) {
    if (!f) continue;
    structural.add(f.id);
    const twin = linkOptionsOf(f).symmetricFieldId;
    if (twin) structural.add(twin);
  }
  return structural;
};

const resolveEdges = (
  input: IResolverInput,
  plans: IGraphTablePlan[],
  included: ReadonlySet<string>
) => {
  const structural = structuralFieldIds(plans);
  const isEligible = (field: IFieldInstance) =>
    isRealLinkField(field) &&
    !structural.has(field.id) &&
    !isCrossBaseLink(field, input.baseId) &&
    included.has(linkOptionsOf(field).foreignTableId);

  const eligible = new Map<string, { plan: IGraphTablePlan; field: IFieldInstance }>();
  for (const p of plans) {
    for (const field of (input.fieldsByTable.get(p.tableId) ?? []).filter(isEligible)) {
      eligible.set(field.id, { plan: p, field });
    }
  }

  const requested = input.ro.linkFieldIds;
  if (requested) {
    const unknown = requested.filter((id) => !eligible.has(id));
    if (unknown.length) {
      throw badRequest(
        `Link fields not drawable between the selected tables: ${unknown.join(', ')}`
      );
    }
  }
  const chosen = requested ? new Set(requested) : new Set(eligible.keys());

  for (const id of [...chosen].sort()) {
    const { plan, field } = eligible.get(id) as { plan: IGraphTablePlan; field: IFieldInstance };
    const twin = linkOptionsOf(field).symmetricFieldId;
    // Read one side of a pair: the smaller id when both are drawn.
    if (twin && chosen.has(twin) && twin < field.id) {
      continue;
    }
    const pairId = twin && twin < field.id ? twin : field.id;
    plan.edgeFields.push({ fieldId: field.id, pairId });
    plan.readFields.push(field);
  }
};

const isProbeSafe = (input: IResolverInput, plan: IGraphTablePlan): boolean => {
  const computed = new Set(
    (input.fieldsByTable.get(plan.tableId) ?? []).filter((f) => f.isComputed).map((f) => f.id)
  );
  const used = [
    ...[plan.primaryField, plan.hierarchyField, plan.groupField, ...plan.readFields]
      .filter((f): f is IFieldInstance => Boolean(f))
      .map((f) => f.id),
    ...extractFieldIdsFromFilter(plan.filter, true),
    ...(plan.viewId ? input.viewFilterFieldIds?.get(plan.viewId) ?? [] : []),
  ];
  return !used.some((id) => computed.has(id));
};

/**
 * Validates a query against the base's metadata and turns it into a plan. Pure:
 * every lookup it needs is handed in, so the rules are unit-testable without a
 * database. Wrong input is a 400 naming the problem, never an empty graph.
 */
export const resolveGraphPlan = (input: IResolverInput): IGraphPlan => {
  const { ro, config } = input;
  const nameOf = new Map(input.tables.map((t) => [t.id, t.name]));
  for (const t of ro.tables) {
    if (!nameOf.has(t.tableId)) {
      throw new CustomHttpException(
        `Table ${t.tableId} does not belong to base ${input.baseId}`,
        HttpErrorCode.NOT_FOUND
      );
    }
  }

  const maxNodes = Math.min(ro.maxNodes ?? config.maxNodes, config.maxNodes);
  const maxLinks = Math.min(ro.maxLinks ?? config.maxLinks, config.maxLinks);
  const included = new Set(ro.tables.map((t) => t.tableId));

  const plans = ro.tables.map((t) =>
    resolveTable(input, t, nameOf.get(t.tableId) as string, included, maxNodes)
  );
  assertNoGroupCycle(plans);
  resolveEdges(input, plans, included);
  for (const plan of plans) {
    plan.probeSafe = isProbeSafe(input, plan);
  }

  return {
    baseId: input.baseId,
    tables: plans,
    assembler: {
      tables: plans.map(
        ({ tableId, name, hierarchyFieldId, groupFieldId, groupTargetTableId, edgeFields }) => ({
          tableId,
          name,
          hierarchyFieldId,
          groupFieldId,
          groupTargetTableId,
          edgeFields,
        })
      ),
      maxNodes,
      maxLinks,
      showTableHubs: Boolean(ro.showTableHubs),
      showBaseHub: Boolean(ro.showBaseHub),
      baseLabel: input.labels.base,
      unclassifiedLabel: input.labels.unclassified,
    },
  };
};

const filterFieldIdsOf = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    return extractFieldIdsFromFilter(JSON.parse(raw) as IFilter, true);
  } catch {
    return [];
  }
};

@Injectable()
export class GraphPlanResolver {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    @BaseGraphConfig() private readonly config: IBaseGraphConfig
  ) {}

  /**
   * One query for table ownership instead of one per table, which is also the
   * permission boundary: a table outside `baseId` is simply not found.
   */
  async resolve(baseId: string, ro: IBaseGraphQueryRo): Promise<IGraphPlan> {
    const tableIds = ro.tables.map((t) => t.tableId);
    const [base, tables, views] = await Promise.all([
      this.prismaService.base.findFirst({
        where: { id: baseId, deletedTime: null },
        select: { name: true },
      }),
      this.prismaService.tableMeta.findMany({
        where: { id: { in: tableIds }, baseId, deletedTime: null },
        select: { id: true, name: true },
      }),
      this.prismaService.view.findMany({
        where: { tableId: { in: tableIds }, deletedTime: null },
        select: { id: true, tableId: true, filter: true },
      }),
    ]);

    const fieldsByTable = new Map<string, IFieldInstance[]>();
    for (const table of tables) {
      fieldsByTable.set(table.id, await this.recordService.getFieldsByProjection(table.id));
    }
    const viewIdsByTable = new Map<string, Set<string>>();
    const viewFilterFieldIds = new Map<string, string[]>();
    for (const view of views) {
      viewFilterFieldIds.set(view.id, filterFieldIdsOf(view.filter));
      const set = viewIdsByTable.get(view.tableId) ?? new Set<string>();
      set.add(view.id);
      viewIdsByTable.set(view.tableId, set);
    }

    return resolveGraphPlan({
      baseId,
      ro,
      tables,
      fieldsByTable,
      viewIdsByTable,
      viewFilterFieldIds,
      config: this.config,
      labels: { base: base?.name ?? baseId, unclassified: 'Unclassified' },
    });
  }
}
