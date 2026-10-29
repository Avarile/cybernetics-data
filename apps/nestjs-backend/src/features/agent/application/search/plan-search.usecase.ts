import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { CustomHttpException } from '../../../../custom.exception';
import {
  SCHEMA_CATALOG_PORT,
  SEARCH_LOG_PORT,
  type ISchemaCatalogPort,
  type ISearchLogPort,
} from '../../domain/ports';
import { buildPlan, PlanError, type IPlanRequest } from '../../domain/search/planner';
import { recipeFor } from '../../domain/search/recipes';
import { RelationGraph } from '../../domain/search/relation-graph';
import { systemTable } from '../../domain/search/schema';
import type { ISearchPlan, IStepState } from '../../domain/search/search.types';

export interface IPlannedSearch {
  plan: ISearchPlan;
  graph: RelationGraph;
  /** The question is about one anchor record (a close tie needs the admin's choice). */
  single: boolean;
}

export const pendingStates = (plan: ISearchPlan): IStepState[] =>
  plan.steps.map((s) => ({ stepId: s.id, status: 'pending', found: 0, shown: 0 }));

/**
 * Cockpit design §6.5: the plan of a question over the data base's live schema, logged before
 * it runs. A plan that cannot be made comes back to the model as an error saying what to fix.
 */
@Injectable()
export class PlanSearch {
  constructor(
    @Inject(SCHEMA_CATALOG_PORT) private readonly catalog: ISchemaCatalogPort,
    @Inject(SEARCH_LOG_PORT) private readonly log: ISearchLogPort
  ) {}

  async plan(input: {
    request: Omit<IPlanRequest, 'searchId'>;
    dataBaseId: string | null;
    runId: string;
    threadId: string;
  }): Promise<IPlannedSearch> {
    const base = await this.catalog.dataBase(input.dataBaseId);
    if (!base) {
      throw new CustomHttpException(
        'No data base to search: none has the tables the recipes use. Set agent_setup.data_base_id.',
        HttpErrorCode.CONFLICT
      );
    }
    const schema = await this.catalog.schema(base.id);
    const graph = new RelationGraph(schema.tables);
    let plan: ISearchPlan;
    try {
      plan = buildPlan(
        { ...input.request, searchId: this.log.newId() },
        { graph, baseId: base.id, excluded: schema.excluded }
      );
    } catch (error) {
      if (error instanceof PlanError) {
        throw new CustomHttpException(error.message, HttpErrorCode.VALIDATION_ERROR);
      }
      throw error;
    }
    await this.log.create({
      id: plan.id,
      runId: input.runId,
      threadId: input.threadId,
      plan,
      states: pendingStates(plan),
    });
    return {
      plan,
      graph,
      single: !input.request.steps?.length && Boolean(recipeFor(plan.intent)?.single),
    };
  }

  /** Table names of the data base, for the prompt; undefined when there is none. */
  async tableNames(dataBaseId: string | null) {
    const base = await this.catalog.dataBase(dataBaseId);
    if (!base) return undefined;
    const schema = await this.catalog.schema(base.id);
    return {
      base: base.name,
      tables: schema.tables
        .filter((t) => !schema.excluded.has(t.id) && !systemTable.test(t.name))
        .map((t) => t.name),
    };
  }
}
