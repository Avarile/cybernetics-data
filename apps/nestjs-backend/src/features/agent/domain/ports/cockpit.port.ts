/* eslint-disable @typescript-eslint/naming-convention */

export interface ICockpitBaseRow {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
}

export interface ICockpitTableRow {
  id: string;
  name: string;
  baseId: string;
}

/** A record as the cockpit reads it: cells by field id, as text (the grid's text format). */
export interface ICockpitRecordRow {
  id: string;
  cells: Record<string, string>;
  /** When the record last changed (ISO), when known. */
  lastModifiedTime?: string;
}

/**
 * Scope design §10: what the cockpit reads, as the admin. Bases and tables of the Agent space,
 * and deleted ones, do not exist here.
 */
export interface ICockpitDataPort {
  /** Bases the admin can open. */
  listBases(): Promise<ICockpitBaseRow[]>;
  base(baseId: string): Promise<{ id: string; name: string } | undefined>;
  table(tableId: string): Promise<ICockpitTableRow | undefined>;
  /** Refuses (403) an admin without these permissions on the base. */
  assertAllowed(baseId: string, permissions: ('table|read' | 'record|read')[]): Promise<void>;
  /** The table page's Search: every field, matching rows only, the first `take` and the total. */
  search(
    tableId: string,
    q: string,
    take: number
  ): Promise<{ records: ICockpitRecordRow[]; total: number }>;
  readRecord(tableId: string, recordId: string): Promise<ICockpitRecordRow | undefined>;
}

export const COCKPIT_DATA_PORT = Symbol('AGENT_COCKPIT_DATA_PORT');
