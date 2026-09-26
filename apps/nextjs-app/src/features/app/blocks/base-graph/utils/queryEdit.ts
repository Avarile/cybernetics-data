import type {
  IBaseGraphLinkField,
  IBaseGraphQueryRo,
  IBaseGraphSchemaTable,
  IBaseGraphSchemaVo,
  IBaseGraphTableQuery,
} from '@teable/openapi';

/**
 * Pure edits of a graph query, kept out of the panel so the rules are testable.
 * The server revalidates everything; these only keep the UI from offering
 * choices it would reject.
 */

export const hierarchyCandidates = (table: IBaseGraphSchemaTable): IBaseGraphLinkField[] =>
  table.linkFields.filter((l) => l.isSelfLink && !l.isMultipleCellValue && !l.isCrossBase);

export const groupCandidates = (table: IBaseGraphSchemaTable): IBaseGraphLinkField[] =>
  table.linkFields.filter((l) => !l.isSelfLink && !l.isMultipleCellValue && !l.isCrossBase);

export const toggleTable = (
  schema: IBaseGraphSchemaVo,
  ro: IBaseGraphQueryRo,
  table: IBaseGraphSchemaTable
): IBaseGraphQueryRo | null => {
  const exists = ro.tables.some((t) => t.tableId === table.id);
  if (exists) {
    const tables = ro.tables.filter((t) => t.tableId !== table.id);
    // The server needs at least one table; an empty selection is "no query".
    if (!tables.length) return null;
    return pruneLinks({ ...ro, tables }, schema);
  }
  const entry: IBaseGraphTableQuery = { tableId: table.id };
  if (table.suggestedHierarchyFieldId) entry.hierarchyFieldId = table.suggestedHierarchyFieldId;
  return { ...ro, tables: [...ro.tables, entry] };
};

export const updateTable = (
  schema: IBaseGraphSchemaVo,
  ro: IBaseGraphQueryRo,
  tableId: string,
  patch: Partial<IBaseGraphTableQuery>
): IBaseGraphQueryRo =>
  pruneLinks(
    {
      ...ro,
      tables: ro.tables.map((t) => {
        if (t.tableId !== tableId) return t;
        const next: IBaseGraphTableQuery = { ...t, ...patch };
        // Remove keys explicitly cleared, so the URL does not carry `null`s.
        for (const key of Object.keys(patch) as (keyof IBaseGraphTableQuery)[]) {
          if (patch[key] === undefined || patch[key] === null) delete next[key];
        }
        return next;
      }),
    },
    schema
  );

export interface IRelationship {
  /** Stable id: the smaller of the pair's field ids. */
  id: string;
  /** Every field id of the pair present in the base (one or two). */
  fieldIds: string[];
  label: string;
}

/**
 * Link fields drawable between the selected tables, a two-way pair collapsed to
 * one entry, minus the fields already used as a tree or group (and their
 * twins) — the same rules the server's resolver applies.
 */
/** Tree and group fields of the query, and their symmetric twins. */
const structuralIds = (
  ro: IBaseGraphQueryRo,
  fieldById: ReadonlyMap<string, IBaseGraphLinkField>
): Set<string> => {
  const out = new Set<string>();
  for (const id of ro.tables.flatMap((q) => [q.hierarchyFieldId, q.groupByFieldId])) {
    if (!id) continue;
    out.add(id);
    const twin = fieldById.get(id)?.symmetricFieldId;
    if (twin) out.add(twin);
  }
  return out;
};

/** The id both sides of a two-way pair agree on: the smaller field id. */
const pairIdOf = (
  link: IBaseGraphLinkField,
  fieldById: ReadonlyMap<string, IBaseGraphLinkField>
) => {
  const twin = link.symmetricFieldId;
  return twin && fieldById.has(twin) && twin < link.id ? twin : link.id;
};

export const relationshipsOf = (
  schema: IBaseGraphSchemaVo,
  ro: IBaseGraphQueryRo
): IRelationship[] => {
  const included = new Set(ro.tables.map((t) => t.tableId));
  const tables = schema.tables.filter((t) => included.has(t.id));
  const nameOf = new Map(schema.tables.map((t) => [t.id, t.name]));
  const fieldById = new Map(tables.flatMap((t) => t.linkFields.map((l) => [l.id, l] as const)));
  const structural = structuralIds(ro, fieldById);
  const drawable = (link: IBaseGraphLinkField) =>
    !link.isCrossBase && !structural.has(link.id) && included.has(link.foreignTableId);

  const out = new Map<string, IRelationship>();
  for (const table of tables) {
    for (const link of table.linkFields.filter(drawable)) {
      const id = pairIdOf(link, fieldById);
      const existing = out.get(id);
      if (existing) {
        existing.fieldIds.push(link.id);
      } else {
        out.set(id, {
          id,
          fieldIds: [link.id],
          label: `${table.name}.${link.name} → ${nameOf.get(link.foreignTableId) ?? link.foreignTableId}`,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
};

export const isRelationshipOn = (ro: IBaseGraphQueryRo, rel: IRelationship): boolean =>
  !ro.linkFieldIds || rel.fieldIds.some((id) => ro.linkFieldIds?.includes(id));

export const toggleRelationship = (
  schema: IBaseGraphSchemaVo,
  ro: IBaseGraphQueryRo,
  rel: IRelationship
): IBaseGraphQueryRo => {
  const all = relationshipsOf(schema, ro);
  const on = new Set(all.filter((r) => isRelationshipOn(ro, r)).map((r) => r.id));
  if (on.has(rel.id)) on.delete(rel.id);
  else on.add(rel.id);
  const linkFieldIds = all.filter((r) => on.has(r.id)).flatMap((r) => r.fieldIds);
  return { ...ro, linkFieldIds };
};

/**
 * Drops link ids that are no longer drawable after a table or tree/group change
 * — the server rejects an undrawable id with a 400.
 */
export const pruneLinks = (
  ro: IBaseGraphQueryRo,
  schema?: IBaseGraphSchemaVo
): IBaseGraphQueryRo => {
  if (!ro.linkFieldIds || !schema) return ro;
  const drawable = new Set(relationshipsOf(schema, ro).flatMap((r) => r.fieldIds));
  return { ...ro, linkFieldIds: ro.linkFieldIds.filter((id) => drawable.has(id)) };
};
