import type { IBaseGraphLink } from '@teable/openapi';
import { recordNodeId } from '@teable/openapi';
import type { IBudgetedTable } from './budget';
import type { IAssemblerTable } from './types';

interface IPair {
  source: string;
  target: string;
  fieldId: string;
}

export interface ILinkEdges {
  links: IBaseGraphLink[];
  /** Deduped pairs touching each record, counted BEFORE the link budget. */
  linkDegree: Map<string, number>;
  danglingLinks: number;
  truncated: boolean;
}

class PairCollector {
  readonly pairs: IPair[] = [];
  danglingLinks = 0;
  private readonly seen = new Set<string>();

  constructor(private readonly emittedIds: ReadonlySet<string>) {}

  /** One link cell of one record: every target becomes a pair or a dangling count. */
  add(recordId: string, fieldId: string, pairId: string, targets: readonly string[]) {
    for (const other of targets) {
      if (other === recordId || !this.emittedIds.has(other)) {
        this.danglingLinks++;
        continue;
      }
      const [a, b] = recordId < other ? [recordId, other] : [other, recordId];
      const key = `${pairId}|${a}|${b}`;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        this.pairs.push({ source: a, target: b, fieldId });
      }
    }
  }
}

/**
 * Link-field values → `link` edges. A two-way link arrives from both ends when
 * both of its fields are read, so pairs are keyed on the field pair id plus the
 * unordered record pair; the resolver already reads one side only, and this is
 * the safety net for a relation that is populated from both ends by hand.
 *
 * Structural links are never displaced: only these edges are cut, to whatever
 * budget remains after them.
 */
export const buildLinkEdges = (
  tables: readonly IAssemblerTable[],
  budgeted: ReadonlyMap<string, IBudgetedTable>,
  emittedIds: ReadonlySet<string>,
  roomForLinks: number
): ILinkEdges => {
  const collector = new PairCollector(emittedIds);
  for (const table of tables) {
    const pairIdOf = new Map(table.edgeFields.map((f) => [f.fieldId, f.pairId]));
    for (const row of budgeted.get(table.tableId)?.rows ?? []) {
      for (const cell of row.links) {
        const pairId = pairIdOf.get(cell.fieldId);
        if (pairId) {
          collector.add(row.recordId, cell.fieldId, pairId, cell.targetRecordIds);
        }
      }
    }
  }
  const { pairs, danglingLinks } = collector;

  pairs.sort(
    (x, y) =>
      x.source.localeCompare(y.source) ||
      x.target.localeCompare(y.target) ||
      x.fieldId.localeCompare(y.fieldId)
  );

  // Degree counts every pair, not only the budgeted ones: it drives node size,
  // and a hub must not visually shrink because the budget hid some of its edges.
  const linkDegree = new Map<string, number>();
  for (const pair of pairs) {
    linkDegree.set(pair.source, (linkDegree.get(pair.source) ?? 0) + 1);
    linkDegree.set(pair.target, (linkDegree.get(pair.target) ?? 0) + 1);
  }

  const room = Math.max(0, roomForLinks);
  const truncated = pairs.length > room;
  const kept = truncated ? pairs.slice(0, room) : pairs;

  return {
    links: kept.map((pair) => ({
      source: recordNodeId(pair.source),
      target: recordNodeId(pair.target),
      kind: 'link',
      fieldId: pair.fieldId,
    })),
    linkDegree,
    danglingLinks,
    truncated,
  };
};
