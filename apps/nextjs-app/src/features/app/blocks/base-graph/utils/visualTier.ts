/* eslint-disable sonarjs/no-duplicate-string */
import type { IBaseGraphLink, IBaseGraphNode } from '@teable/openapi';

/**
 * The layout physics in graphTheme.ts were tuned, at length, against the three
 * tiers of the knowledge graph. Rather than re-tune for v4's kinds, every node
 * and link is mapped onto the tier it plays visually:
 *
 * - `core`: the base hub — invisible, holds the branches together.
 * - `type`: anything records hang from — table hubs, synthetic groups, and
 *   records of a table that other tables group by (knowledge_type).
 * - `knowledge`: every other record.
 *
 * Under the knowledge preset this reproduces the old tiers exactly, so that
 * view renders as before; any other table inherits the same proven layout.
 */
export const VisualNodeTierValues = ['core', 'type', 'knowledge'] as const;
export type VisualNodeTier = (typeof VisualNodeTierValues)[number];

export const VisualLinkTierValues = [
  'core-type',
  'type-parent',
  'type-knowledge',
  'knowledge-parent',
  'knowledge-knowledge',
] as const;
export type VisualLinkTier = (typeof VisualLinkTierValues)[number];

/** Tables whose records are group targets: a `group` link starts at one of their records. */
export const groupTargetTables = (
  nodes: readonly Pick<IBaseGraphNode, 'id' | 'kind' | 'tableId'>[],
  links: readonly Pick<IBaseGraphLink, 'source' | 'kind'>[]
): Set<string> => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const link of links) {
    if (link.kind !== 'group') continue;
    const source = byId.get(link.source);
    if (source?.kind === 'record' && source.tableId) {
      out.add(source.tableId);
    }
  }
  return out;
};

export const nodeTierOf = (
  node: Pick<IBaseGraphNode, 'kind' | 'tableId'>,
  typeTables: ReadonlySet<string>
): VisualNodeTier => {
  if (node.kind === 'base') return 'core';
  if (node.kind === 'table' || node.kind === 'group') return 'type';
  return node.tableId && typeTables.has(node.tableId) ? 'type' : 'knowledge';
};

export const linkTierOf = (
  link: Pick<IBaseGraphLink, 'kind' | 'source' | 'target'>,
  tierOf: (id: string) => VisualNodeTier | undefined
): VisualLinkTier => {
  switch (link.kind) {
    case 'hub':
      if (tierOf(link.source) === 'core') return 'core-type';
      return tierOf(link.target) === 'type' ? 'type-parent' : 'type-knowledge';
    case 'group':
      return 'type-knowledge';
    case 'hierarchy':
      return tierOf(link.source) === 'type' ? 'type-parent' : 'knowledge-parent';
    default:
      return 'knowledge-knowledge';
  }
};
