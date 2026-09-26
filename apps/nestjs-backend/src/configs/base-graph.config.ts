/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

/**
 * Budgets for the schema-driven base graph. Client-supplied budgets are
 * clamped to these, never trusted.
 *
 * Defaults live here rather than in the Joi schema for the same reason as
 * knowledge.config.ts: Joi writes its defaults onto process.env before this
 * factory runs.
 */
export const baseGraphConfig = registerAs('baseGraph', () => ({
  maxNodes: Number(process.env.BASE_GRAPH_MAX_NODES ?? 5000),
  /** Link cost is superlinear in node count — one hub carries hundreds. */
  maxLinks: Number(process.env.BASE_GRAPH_MAX_LINKS ?? 15000),
  defaultTableLimit: Number(process.env.BASE_GRAPH_DEFAULT_TABLE_LIMIT ?? 1000),
  cacheTtlSeconds: Number(process.env.BASE_GRAPH_CACHE_TTL ?? 60),
}));

export const BaseGraphConfig = () => Inject(baseGraphConfig.KEY);

export type IBaseGraphConfig = ConfigType<typeof baseGraphConfig>;
