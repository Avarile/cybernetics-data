/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { FieldKeyType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IBaseGraphExpandRo,
  IBaseGraphExpandVo,
  IBaseGraphLink,
  IBaseGraphNode,
  IBaseGraphNodeVo,
  IGetBaseGraphNodeQuery,
} from '@teable/openapi';
import { recordNodeId, tableNodeId } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import type { IFieldInstance } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import { isCrossBaseLink, isRealLinkField, linkOptionsOf } from './graph-plan.resolver';
import { labelOf } from './graph-row.reader';
import { extractLinkRecordId, extractRelatedRecordIds } from './link-cells';

/** Detail shows a readable card, not the whole record. */
const MAX_DETAIL_FIELDS = 20;
/** Ancestor walk is one read per level; a real taxonomy is never this deep. */
const MAX_ANCESTOR_DEPTH = 32;
const DEFAULT_EXPAND_LIMIT = 200;

type IColumnMeta = Record<string, { order?: number; hidden?: boolean } | undefined>;

const parseColumnMeta = (raw: string | null | undefined): IColumnMeta => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as IColumnMeta;
  } catch {
    return {};
  }
};

/**
 * Primary first, then the default view's visible columns in its order — what
 * the user sees in the grid, capped. A field with no column meta keeps load
 * order at the end.
 */
export const detailFieldOrder = (fields: IFieldInstance[], columnMeta: IColumnMeta) => {
  const primary = fields.find((f) => f.isPrimary);
  const rest = fields
    .filter((f) => !f.isPrimary && !columnMeta[f.id]?.hidden)
    .map((f, index) => ({ f, order: columnMeta[f.id]?.order ?? Number.MAX_SAFE_INTEGER, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ f }) => f);
  return [...(primary ? [primary] : []), ...rest].slice(0, MAX_DETAIL_FIELDS);
};

/**
 * Which linked records to fetch (new to the client, within the limit) and which
 * edges to report. A record already queued or held by the client is not
 * fetched again but still gets its edge.
 */
export const collectNeighbours = (
  seedId: string,
  cells: { fieldId: string; foreignTableId: string; targets: string[] }[],
  exclude: ReadonlySet<string>,
  limit: number
) => {
  const toFetch = new Map<string, string[]>();
  const edges: { other: string; fieldId: string }[] = [];
  const queued = new Set<string>();
  let truncated = false;

  for (const cell of cells) {
    for (const other of cell.targets) {
      if (other === seedId) continue;
      const known = exclude.has(recordNodeId(other)) || queued.has(other);
      if (!known && queued.size >= limit) {
        truncated = true;
        continue;
      }
      if (!known) {
        queued.add(other);
        toFetch.set(cell.foreignTableId, [...(toFetch.get(cell.foreignTableId) ?? []), other]);
      }
      edges.push({ other, fieldId: cell.fieldId });
    }
  }
  return { toFetch, edges, truncated };
};

@Injectable()
export class GraphNodeService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService
  ) {}

  async getNode(
    baseId: string,
    recordId: string,
    query: IGetBaseGraphNodeQuery
  ): Promise<IBaseGraphNodeVo> {
    const { tableId } = query;
    const table = await this.assertTableInBase(baseId, tableId);
    const fields = await this.recordService.getFieldsByProjection(tableId);
    const primary = this.primaryOf(fields, tableId);
    const hierarchyField = query.hierarchyFieldId
      ? this.hierarchyFieldOf(fields, query.hierarchyFieldId, tableId)
      : null;

    const view = await this.prismaService.view.findFirst({
      where: { tableId, deletedTime: null },
      orderBy: { order: 'asc' },
      select: { columnMeta: true },
    });
    const shown = detailFieldOrder(fields, parseColumnMeta(view?.columnMeta));
    const links = fields.filter(isRealLinkField);
    const projection = [
      ...new Set(
        [...shown, ...links, ...(hierarchyField ? [hierarchyField] : [])].map((f) => f.id)
      ),
    ];

    // fieldKeyType is mandatory: getRecord defaults to Name keys.
    const record = await this.recordService.getRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      projection,
    });

    const ancestors = hierarchyField
      ? await this.ancestorsOf(
          tableId,
          primary,
          hierarchyField,
          recordId,
          extractLinkRecordId(record.fields[hierarchyField.id])
        )
      : [];

    return {
      id: recordNodeId(record.id),
      recordId: record.id,
      tableId,
      tableName: table.name,
      label: labelOf(primary, record.fields[primary.id]),
      fields: shown.map((f) => ({
        fieldId: f.id,
        name: f.name,
        type: f.type,
        cellValue: record.fields[f.id] ?? null,
      })),
      linkCounts: links.map((f) => ({
        fieldId: f.id,
        name: f.name,
        foreignTableId: linkOptionsOf(f).foreignTableId,
        count: extractRelatedRecordIds(record.fields[f.id]).length,
      })),
      ancestors,
      createdTime: record.createdTime ?? null,
      lastModifiedTime: record.lastModifiedTime ?? null,
    };
  }

  /**
   * A record's linked neighbours, for growing the graph from a node outward.
   * Only same-base tables: every foreign table is checked against `baseId`.
   * Links to ids in `exclude` are still returned — the client has those nodes
   * and needs the edges — but those nodes are not re-sent.
   */
  async expand(baseId: string, ro: IBaseGraphExpandRo): Promise<IBaseGraphExpandVo> {
    await this.assertTableInBase(baseId, ro.tableId);
    const fields = await this.recordService.getFieldsByProjection(ro.tableId);
    const candidates = fields.filter((f) => isRealLinkField(f) && !isCrossBaseLink(f, baseId));

    if (ro.linkFieldIds) {
      const known = new Set(candidates.map((f) => f.id));
      const unknown = ro.linkFieldIds.filter((id) => !known.has(id));
      if (unknown.length) {
        throw new CustomHttpException(
          `Not expandable link fields on table ${ro.tableId}: ${unknown.join(', ')}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
    }
    const linkFields = ro.linkFieldIds
      ? candidates.filter((f) => ro.linkFieldIds?.includes(f.id))
      : candidates;

    const foreignIds = [...new Set(linkFields.map((f) => linkOptionsOf(f).foreignTableId))];
    const owned = await this.prismaService.tableMeta.findMany({
      where: { id: { in: foreignIds }, baseId, deletedTime: null },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((t) => t.id));
    const usable = linkFields.filter((f) => ownedIds.has(linkOptionsOf(f).foreignTableId));

    const record = await this.recordService.getRecord(ro.tableId, ro.recordId, {
      fieldKeyType: FieldKeyType.Id,
      projection: usable.map((f) => f.id),
    });

    const exclude = new Set(ro.exclude ?? []);
    const { toFetch, edges, truncated } = collectNeighbours(
      ro.recordId,
      usable.map((field) => ({
        fieldId: field.id,
        foreignTableId: linkOptionsOf(field).foreignTableId,
        targets: extractRelatedRecordIds(record.fields[field.id]),
      })),
      exclude,
      ro.limit ?? DEFAULT_EXPAND_LIMIT
    );

    const nodes: IBaseGraphNode[] = [];
    for (const [foreignTableId, ids] of toFetch) {
      nodes.push(...(await this.neighbourNodes(foreignTableId, ids)));
    }

    // Edges only to nodes the client will have: excluded ones or ones returned.
    const returned = new Set(nodes.map((n) => n.recordId as string));
    const links: IBaseGraphLink[] = edges
      .filter(({ other }) => returned.has(other) || exclude.has(recordNodeId(other)))
      .map(({ other, fieldId }) => {
        const [a, b] = ro.recordId < other ? [ro.recordId, other] : [other, ro.recordId];
        return { source: recordNodeId(a), target: recordNodeId(b), kind: 'link', fieldId };
      });

    return { nodes, links, truncated };
  }

  private async neighbourNodes(foreignTableId: string, ids: string[]): Promise<IBaseGraphNode[]> {
    const fields = await this.recordService.getFieldsByProjection(foreignTableId);
    const primary = this.primaryOf(fields, foreignTableId);
    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      foreignTableId,
      ids,
      { [primary.id]: true },
      FieldKeyType.Id
    );
    return snapshots.map(({ data }) => ({
      id: recordNodeId(data.id),
      kind: 'record',
      tableId: foreignTableId,
      recordId: data.id,
      label: labelOf(primary, data.fields[primary.id]),
      parentId: null,
      colorKey: tableNodeId(foreignTableId),
      depth: 0,
      degree: 1,
    }));
  }

  /**
   * Root-first breadcrumb along a self-link, one read per level. Stops at a
   * cycle, a missing parent, or the depth cap — never loops.
   */
  private async ancestorsOf(
    tableId: string,
    primary: IFieldInstance,
    hierarchyField: IFieldInstance,
    selfId: string,
    firstParent: string | null
  ): Promise<{ id: string; label: string }[]> {
    const chain: { id: string; label: string }[] = [];
    const seen = new Set<string>([selfId]);
    let current = firstParent;
    while (current && !seen.has(current) && chain.length < MAX_ANCESTOR_DEPTH) {
      seen.add(current);
      let parent;
      try {
        parent = await this.recordService.getRecord(tableId, current, {
          fieldKeyType: FieldKeyType.Id,
          projection: [primary.id, hierarchyField.id],
        });
      } catch {
        break;
      }
      chain.unshift({
        id: recordNodeId(parent.id),
        label: labelOf(primary, parent.fields[primary.id]),
      });
      current = extractLinkRecordId(parent.fields[hierarchyField.id]);
    }
    return chain;
  }

  private async assertTableInBase(baseId: string, tableId: string) {
    const table = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null },
      select: { id: true, name: true },
    });
    if (!table) {
      throw new CustomHttpException(
        `Table ${tableId} does not belong to base ${baseId}`,
        HttpErrorCode.NOT_FOUND
      );
    }
    return table;
  }

  private primaryOf(fields: IFieldInstance[], tableId: string): IFieldInstance {
    const primary = fields.find((f) => f.isPrimary);
    if (!primary) {
      throw new CustomHttpException(
        `Table ${tableId} has no primary field`,
        HttpErrorCode.NOT_FOUND
      );
    }
    return primary;
  }

  private hierarchyFieldOf(fields: IFieldInstance[], fieldId: string, tableId: string) {
    const field = fields.find((f) => f.id === fieldId);
    if (
      !field ||
      !isRealLinkField(field) ||
      field.isMultipleCellValue ||
      linkOptionsOf(field).foreignTableId !== tableId
    ) {
      throw new CustomHttpException(
        `Field ${fieldId} is not a single-valued self-link on table ${tableId}`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    return field;
  }
}
