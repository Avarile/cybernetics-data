/* eslint-disable @typescript-eslint/naming-convention */
import type {
  ISearchCard,
  ISearchIntent,
  ISearchPlan,
  ISearchStatus,
  IStepState,
} from '../search/search.types';

/** A search as it is kept (cockpit design §7.3): the plan, each step's state and its cards. */
export interface IStoredSearch {
  id: string;
  runId: string;
  threadId: string;
  intent: ISearchIntent;
  plan: ISearchPlan;
  states: IStepState[];
  cards: ISearchCard[];
  lens: string[];
  status: ISearchStatus;
  createdAt: string;
}

/** Searches the agent ran, kept for replay; saved after every step. */
export interface ISearchLogPort {
  /** A new search id, before the plan (which carries it) is built. */
  newId(): string;
  create(input: {
    id: string;
    runId: string;
    threadId: string;
    plan: ISearchPlan;
    states: IStepState[];
  }): Promise<IStoredSearch>;
  /** Replaces the steps' states and cards (and the status); appends nothing by itself. */
  save(
    id: string,
    patch: { plan?: ISearchPlan; states: IStepState[]; cards: ISearchCard[]; status: ISearchStatus }
  ): Promise<void>;
  setLens(id: string, recordKeys: string[]): Promise<void>;
  get(id: string): Promise<IStoredSearch | undefined>;
  listByThread(threadId: string): Promise<IStoredSearch[]>;
  /** The latest search of a run, if it made one. */
  latestOfRun(runId: string): Promise<IStoredSearch | undefined>;
}

export const SEARCH_LOG_PORT = Symbol('AGENT_SEARCH_LOG_PORT');
