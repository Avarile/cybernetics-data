import { getRandomString } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import type { AgentSearch } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { ISearchLogPort, IStoredSearch } from '../../domain/ports';
import type {
  ISearchCard,
  ISearchIntent,
  ISearchPlan,
  ISearchStatus,
  IStepState,
} from '../../domain/search/search.types';

/** Cards kept per search (cockpit design §7.4). */
export const MAX_STORED_CARDS = 500;

interface IStepsJson {
  states?: IStepState[];
  cards?: ISearchCard[];
}

const parse = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

const toSearch = (row: AgentSearch): IStoredSearch => {
  const steps = parse<IStepsJson | unknown[]>(row.steps, {});
  const { states = [], cards = [] } = Array.isArray(steps) ? {} : steps;
  return {
    id: row.id,
    runId: row.runId,
    threadId: row.threadRecordId,
    intent: row.intent as ISearchIntent,
    plan: parse<ISearchPlan>(row.plan, {} as ISearchPlan),
    states,
    cards,
    lens: parse<string[]>(row.lens, []),
    status: row.status as ISearchStatus,
    createdAt: row.createdTime.toISOString(),
  };
};

const stepsJson = (states: IStepState[], cards: ISearchCard[]) =>
  JSON.stringify({ states, cards: cards.slice(0, MAX_STORED_CARDS) });

/** `agent_search` rows (cockpit design §7.3). */
@Injectable()
export class PrismaSearchLog implements ISearchLogPort {
  constructor(private readonly prismaService: PrismaService) {}

  newId() {
    return `srch${getRandomString(16)}`;
  }

  async create(input: {
    id: string;
    runId: string;
    threadId: string;
    plan: ISearchPlan;
    states: IStepState[];
  }) {
    const row = await this.prismaService.agentSearch.create({
      data: {
        id: input.id,
        runId: input.runId,
        threadRecordId: input.threadId,
        intent: input.plan.intent,
        plan: JSON.stringify(input.plan),
        steps: stepsJson(input.states, []),
        status: 'planned',
      },
    });
    return toSearch(row);
  }

  async save(
    id: string,
    patch: { plan?: ISearchPlan; states: IStepState[]; cards: ISearchCard[]; status: ISearchStatus }
  ) {
    await this.prismaService.agentSearch.update({
      where: { id },
      data: {
        ...(patch.plan ? { plan: JSON.stringify(patch.plan) } : {}),
        steps: stepsJson(patch.states, patch.cards),
        status: patch.status,
      },
    });
  }

  async setLens(id: string, recordKeys: string[]) {
    await this.prismaService.agentSearch.update({
      where: { id },
      data: { lens: JSON.stringify(recordKeys) },
    });
  }

  async get(id: string) {
    const row = await this.prismaService.agentSearch.findUnique({ where: { id } });
    return row ? toSearch(row) : undefined;
  }

  async listByThread(threadId: string) {
    const rows = await this.prismaService.agentSearch.findMany({
      where: { threadRecordId: threadId },
      orderBy: { createdTime: 'asc' },
    });
    return rows.map(toSearch);
  }

  async latestOfRun(runId: string) {
    const row = await this.prismaService.agentSearch.findFirst({
      where: { runId },
      orderBy: { createdTime: 'desc' },
    });
    return row ? toSearch(row) : undefined;
  }
}
