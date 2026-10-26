/* eslint-disable @typescript-eslint/naming-convention */

export interface IDataTableRef {
  baseId: string;
  /** Table id or exact name. */
  table: string;
}

export interface IDataQuery extends IDataTableRef {
  /** Teable filter; fieldId may be a field name. */
  filter?: unknown;
  orderBy?: { field: string; order: 'asc' | 'desc' }[];
  search?: string;
  fields?: string[];
  take?: number;
  skip?: number;
  includeDeleted?: boolean;
}

/** A field to create: Teable field type and options. */
export interface IDataFieldSpec {
  name: string;
  type: string;
  options?: Record<string, unknown>;
  description?: string | null;
}

export interface IDataMetric {
  field: string;
  func: string;
}

/**
 * Data and schema across every space and base (design §5.3, §9.2). The adapter runs as the
 * agent principal, so permission checks pass everywhere; caps still apply.
 */
export interface IDataGatewayPort {
  listSpaces(): Promise<{ id: string; name: string }[]>;
  listBases(spaceId?: string): Promise<{ id: string; name: string; spaceId: string }[]>;
  listTables(baseId: string): Promise<{ id: string; name: string; description: string | null }[]>;
  describeTable(ref: IDataTableRef): Promise<unknown>;
  queryRecords(query: IDataQuery): Promise<unknown>;
  getRecords(ref: IDataTableRef & { recordIds: string[] }): Promise<unknown>;
  aggregate(
    ref: IDataTableRef & { metrics: IDataMetric[]; filter?: unknown }
  ): Promise<{ rowCount: number; values: { field: string; func: string; value: unknown }[] }>;
  searchEverywhere(query: string, options?: { baseId?: string; limit?: number }): Promise<unknown>;

  // writes (design §8 data_write, schema); deletes go to the trash
  createRecords(ref: IDataTableRef & { records: Record<string, unknown>[] }): Promise<unknown>;
  updateRecords(
    ref: IDataTableRef & { records: { id: string; fields: Record<string, unknown> }[] }
  ): Promise<unknown>;
  deleteRecords(ref: IDataTableRef & { recordIds: string[] }): Promise<unknown>;
  createTable(input: { baseId: string; name: string; fields: IDataFieldSpec[] }): Promise<unknown>;
  createField(ref: IDataTableRef & { field: IDataFieldSpec }): Promise<unknown>;
  updateField(
    ref: IDataTableRef & { field: string; patch: Partial<IDataFieldSpec> }
  ): Promise<unknown>;
  deleteField(ref: IDataTableRef & { field: string }): Promise<unknown>;
  deleteTable(ref: IDataTableRef): Promise<unknown>;
}

export const DATA_GATEWAY_PORT = Symbol('AGENT_DATA_GATEWAY_PORT');
