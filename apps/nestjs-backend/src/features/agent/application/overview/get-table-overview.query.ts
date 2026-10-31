import { Inject, Injectable } from '@nestjs/common';
import type { IAgentTableOverviewVo, IOverviewNodesVo } from '@teable/openapi';
import { encodeOverview, type IOverviewGraph } from '../../domain/overview/encode';
import { presetOf } from '../../domain/overview/presets';
import { resolveOverview, type IResolvedOverview } from '../../domain/overview/resolve';
import {
  COCKPIT_DATA_PORT,
  OVERVIEW_GRAPH_PORT,
  SCHEMA_CATALOG_PORT,
  type ICockpitDataPort,
  type IOverviewGraphPort,
  type ISchemaCatalogPort,
} from '../../domain/ports';
import { cockpitNotFound } from '../cockpit/cockpit-scope';
import { OVERVIEW_CACHE_MS } from './get-overview.query';

const emptyGraph: IOverviewGraph = {
  nodes: [],
  links: [],
  stats: { perTable: [], truncated: { nodes: false, links: false } },
};

/**
 * Scope design §9: one table of a base as a constellation, the stage the cockpit rotates through,
 * drawn by the dataset it anchors or by a preset derived from its schema. Read as the admin,
 * access checked on every call, rebuilt at most once a minute per admin and table.
 */
@Injectable()
export class GetTableOverview {
  private readonly cache = new Map<string, { at: number; vo: IAgentTableOverviewVo }>();

  constructor(
    @Inject(COCKPIT_DATA_PORT) private readonly data: ICockpitDataPort,
    @Inject(SCHEMA_CATALOG_PORT) private readonly catalog: ISchemaCatalogPort,
    @Inject(OVERVIEW_GRAPH_PORT) private readonly graphs: IOverviewGraphPort
  ) {}

  /** The table, its preset and the dataset resolved against its base. */
  private async resolve(tableId: string, now: Date) {
    const meta = await this.data.table(tableId);
    if (!meta) throw cockpitNotFound('Table');
    await this.graphs.assertReadable(meta.baseId);
    // the admin picked the table: search_exclude (the agent's) does not hide it here
    const schema = { ...(await this.catalog.schema(meta.baseId)), excluded: new Set<string>() };
    const table = schema.tables.find((t) => t.id === tableId);
    if (!table) throw cockpitNotFound('Table');
    const preset = presetOf(table, schema);
    return { table, preset, resolved: resolveOverview(preset.dataset, schema, now) };
  }

  async get(actorUserId: string, tableId: string, now = new Date()) {
    const { table, preset, resolved } = await this.resolve(tableId, now);
    const key = `${actorUserId}:${tableId}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < OVERVIEW_CACHE_MS) return hit.vo;

    const graph = resolved.query
      ? await this.graphs.read(resolved.baseId, resolved.query)
      : emptyGraph;
    const vo: IAgentTableOverviewVo = {
      ...encodeOverview(resolved, graph, now),
      title: table.name.toUpperCase(),
      tableId,
      tableName: table.name,
      preset: preset.preset,
      presentation: preset.presentation,
      builtAt: now.toISOString(),
    };
    this.cache.set(key, { at: now.getTime(), vo });
    return vo;
  }

  /**
   * Records of the table as the overview draws them, with the nodes they hang from (scope design
   * §7.3): the cockpit's forced results that the overview did not read. The table's own filters
   * do not apply to records asked for by id; the dataset's other tables that records hang from
   * are read as the overview reads them, its satellites not at all.
   */
  async nodes(tableId: string, recordIds: string[], now = new Date()): Promise<IOverviewNodesVo> {
    const { resolved } = await this.resolve(tableId, now);
    const tables = resolved.tables.filter(
      (r) => r.table.id === tableId || (r.def.role !== 'actor' && !r.def.prune)
    );
    const queries = (resolved.query?.tables ?? [])
      .filter((q) => tables.some((r) => r.table.id === q.tableId))
      .map((q) => {
        if (q.tableId !== tableId) return q;
        const { filter: _filter, limit: _limit, ...rest } = q;
        return { ...rest, recordIds };
      });
    if (!queries.some((q) => q.tableId === tableId)) return { nodes: [], links: [] };
    const narrowed: IResolvedOverview = {
      ...resolved,
      tables,
      query: { tables: queries, linkFieldIds: [], showTableHubs: false, showBaseHub: false },
      edgeNames: {},
    };
    const graph = await this.graphs.read(resolved.baseId, narrowed.query!);
    const { nodes } = encodeOverview(narrowed, graph, now);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const wanted = new Set(recordIds);
    const keep = new Set<string>();
    for (const n of nodes) {
      if (!n.recordId || !wanted.has(n.recordId) || n.tableId !== tableId) continue;
      for (let at: string | null = n.id; at && !keep.has(at); at = byId.get(at)?.parent ?? null)
        keep.add(at);
    }
    return { nodes: nodes.filter((n) => keep.has(n.id)), links: [] };
  }
}
