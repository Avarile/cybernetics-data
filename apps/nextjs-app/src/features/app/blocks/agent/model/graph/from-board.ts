import type { ISearchCard, ISearchStepRole } from '@teable/openapi';
import type { IBoard } from '../search-board';
import { finishGraph, type IGLink, type IGNode, type IGraph } from './types';

const PEOPLE = 'g:people';

interface IShape {
  cards: Map<string, ISearchCard>;
  roleOf: Map<string, ISearchStepRole>;
}

const linkedIds = (c: ISearchCard) => Object.values(c.links ?? {}).flat();
const role = (shape: IShape, c: ISearchCard) => shape.roleOf.get(c.stepId);

/** Where a record hangs: people on their branch, context on top, the rest under its source. */
function parentOf(shape: IShape, c: ISearchCard, context: ISearchCard[]): string | null {
  switch (role(shape, c)) {
    case 'actor':
      return PEOPLE;
    case 'context':
      return null;
    case 'anchor':
      return (
        context.find((g) => linkedIds(c).includes(g.recordId) || linkedIds(g).includes(c.recordId))
          ?.recordId ?? null
      );
    default: {
      const via = c.via ? shape.cards.get(c.via.recordId) : undefined;
      return via && role(shape, via) !== 'actor' ? via.recordId : null;
    }
  }
}

const nodeOf = (shape: IShape, c: ISearchCard, parent: string | null): IGNode => {
  const r = role(shape, c);
  return {
    id: c.recordId,
    kind: r === 'actor' ? 'actor' : r === 'context' ? 'hub' : 'item',
    label: c.title,
    short: c.short,
    parent,
    tone: c.tone,
    alert: c.alert,
    size: c.size,
    state: c.state?.toUpperCase(),
    table: c.table,
    cardKey: c.key,
    date: c.date ? Date.parse(c.date) : undefined,
    meta: c.fields.map((f) => [f.name, f.value]),
  };
};

/** Every (record, field, linked id) of the cards. */
const cellLinks = (shape: IShape) =>
  [...shape.cards.values()].flatMap((c) =>
    Object.entries(c.links ?? {}).flatMap(([field, ids]) => ids.map((id) => ({ c, field, id })))
  );

/** Links between drawn records that the tree does not already draw, each once. */
function linksOf(shape: IShape, byId: Map<string, IGNode>): IGLink[] {
  const links: IGLink[] = [];
  const seen = new Set<string>();
  for (const { c, field, id } of cellLinks(shape)) {
    const self = byId.get(c.recordId)!;
    const other = byId.get(id);
    const key = [c.recordId, id].sort().join('|');
    const drawn = !other || id === c.recordId || self.parent === id || other.parent === c.recordId;
    if (drawn || seen.has(key)) continue;
    seen.add(key);
    const item = self.kind === 'actor' ? other : self;
    links.push({ id: key, source: c.recordId, target: id, tone: item.tone, label: field });
  }
  return links;
}

/**
 * The search on the board as a constellation (cockpit design §5.4), by the plan's structure:
 * context records (goals) are branches; anchor records hang under the context they link to;
 * every other record hangs under the record it was reached from; actor tables (people) sit on
 * one branch as diamonds, linked to the work they are on; other links become bundled edges.
 */
export function boardToGraph(board: IBoard): IGraph {
  const shape: IShape = {
    roleOf: new Map(board.plan?.steps.map((s) => [s.id, s.role])),
    cards: new Map(),
  };
  for (const c of board.cards) if (!shape.cards.has(c.recordId)) shape.cards.set(c.recordId, c);
  const all = [...shape.cards.values()];
  const context = all.filter((c) => role(shape, c) === 'context');
  const nodes: IGNode[] = all.map((c) => nodeOf(shape, c, parentOf(shape, c, context)));
  if (all.some((c) => role(shape, c) === 'actor')) {
    nodes.unshift({
      id: PEOPLE,
      kind: 'hub',
      label: 'People',
      short: 'PEOPLE',
      parent: null,
      tone: 'none',
    });
  }
  const links = linksOf(shape, new Map(nodes.map((n) => [n.id, n])));
  return finishGraph({ title: board.plan?.summary ?? '', nodes, links });
}
