import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IAgentOverviewVo, IOverviewDatasetId } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import { datasetOf } from '../../domain/overview/datasets';
import { encodeOverview } from '../../domain/overview/encode';
import { resolveOverview } from '../../domain/overview/resolve';
import {
  AGENT_STORE_PORT,
  OVERVIEW_GRAPH_PORT,
  SCHEMA_CATALOG_PORT,
  type IAgentStorePort,
  type IOverviewGraphPort,
  type ISchemaCatalogPort,
} from '../../domain/ports';

/** An overview is rebuilt at most once a minute per admin and dataset (overview design §8.4). */
export const OVERVIEW_CACHE_MS = 60_000;

/**
 * One dataset of the agent's data base as a constellation (overview design §8): the base the
 * searches use, resolved by name, read through the base graph as the admin, encoded with the
 * search's tone rules. Access is checked on every call, cached or not.
 */
@Injectable()
export class GetOverview {
  private readonly cache = new Map<string, { at: number; vo: IAgentOverviewVo }>();

  constructor(
    @Inject(SCHEMA_CATALOG_PORT) private readonly catalog: ISchemaCatalogPort,
    @Inject(OVERVIEW_GRAPH_PORT) private readonly graphs: IOverviewGraphPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {}

  async get(actorUserId: string, dataset: IOverviewDatasetId, now = new Date()) {
    const profile = await this.store.getDefaultProfile().catch(() => undefined);
    const base = await this.catalog.dataBase(profile?.dataBaseId ?? null);
    if (!base) {
      throw new CustomHttpException(
        'No data base to draw: none has the tables the agent reads. Set agent_setup.data_base_id.',
        HttpErrorCode.NOT_FOUND
      );
    }
    await this.graphs.assertReadable(base.id);
    const key = `${actorUserId}:${base.id}:${dataset}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < OVERVIEW_CACHE_MS) return hit.vo;

    const resolved = resolveOverview(datasetOf(dataset), await this.catalog.schema(base.id), now);
    const graph = resolved.query
      ? await this.graphs.read(base.id, resolved.query)
      : {
          nodes: [],
          links: [],
          stats: { perTable: [], truncated: { nodes: false, links: false } },
        };
    const vo: IAgentOverviewVo = {
      ...encodeOverview(resolved, graph, now),
      builtAt: now.toISOString(),
    };
    this.cache.set(key, { at: now.getTime(), vo });
    return vo;
  }
}
