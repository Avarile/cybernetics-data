/** A table as the search domain sees it: fields by name, links with their direction. */
export interface ISchemaField {
  id: string;
  name: string;
  type: string;
  isPrimary?: boolean;
  isComputed?: boolean;
  choices?: string[];
  link?: {
    foreignTableId: string;
    relationship: 'oneOne' | 'oneMany' | 'manyOne' | 'manyMany';
    isOneWay: boolean;
  };
}

export interface ITableSchema {
  id: string;
  name: string;
  baseId: string;
  fields: ISchemaField[];
}

/** A record read by field name. */
export interface IFieldRecord {
  id: string;
  fields: Record<string, unknown>;
}

/** Names of fields that are never shown to the agent's cards (the cockpit's SECRET rule). */
export const secretField = /credential|password|passwd|secret|token|api[ _-]?key|private[ _-]?key/i;

/** Tables that are never searched (system tables of the data bases). */
export const systemTable =
  /^(?:system_info|system_status|auditlog|table_references|template_table)$/i;
