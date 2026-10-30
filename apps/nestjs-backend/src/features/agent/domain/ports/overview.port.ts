/* eslint-disable @typescript-eslint/naming-convention */
import type { IBaseGraphQueryRo } from '@teable/openapi';
import type { IOverviewGraph } from '../overview/encode';

/** Overview design §8.4: the base graph of a dataset, read as the caller. */
export interface IOverviewGraphPort {
  /** Refuses a caller without `record|read` on the base (403). */
  assertReadable(baseId: string): Promise<void>;
  read(baseId: string, query: IBaseGraphQueryRo): Promise<IOverviewGraph>;
}

export const OVERVIEW_GRAPH_PORT = Symbol('AGENT_OVERVIEW_GRAPH_PORT');
