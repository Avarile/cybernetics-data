import type { ISchemaField, ITableSchema } from './schema';

export interface ILinkEdge {
  /** The table holding the link field. */
  table: ITableSchema;
  field: ISchemaField;
  target: ITableSchema;
  relationship: NonNullable<ISchemaField['link']>['relationship'];
  isOneWay: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The tables of one base and the links between them, looked up by name (case-insensitive) or id. */
export class RelationGraph {
  private readonly byKey = new Map<string, ITableSchema>();

  constructor(readonly tables: ITableSchema[]) {
    for (const t of tables) {
      this.byKey.set(t.id, t);
      if (!this.byKey.has(norm(t.name))) this.byKey.set(norm(t.name), t);
    }
  }

  table(nameOrId: string): ITableSchema | undefined {
    return this.byKey.get(nameOrId) ?? this.byKey.get(norm(nameOrId));
  }

  field(table: ITableSchema, name: string): ISchemaField | undefined {
    return table.fields.find((f) => f.id === name || norm(f.name) === norm(name));
  }

  /** The link field `name` on `table`, with its target. */
  link(table: ITableSchema, name: string): ILinkEdge | undefined {
    const field = this.field(table, name);
    const target = field?.link && this.table(field.link.foreignTableId);
    if (!field?.link || !target || field.isComputed) return undefined;
    return {
      table,
      field,
      target,
      relationship: field.link.relationship,
      isOneWay: field.link.isOneWay,
    };
  }

  /** Every link field of `table` whose target is in this base. */
  linksFrom(table: ITableSchema): ILinkEdge[] {
    return table.fields
      .filter((f) => f.link)
      .map((f) => this.link(table, f.name))
      .filter((e): e is ILinkEdge => Boolean(e));
  }
}
