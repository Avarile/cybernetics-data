import { getRandomString, HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { clarifyReasonSchema, searchIntentSchema, searchViewSchema } from '@teable/openapi';
import type { IClarifyPart } from '@teable/openapi';
import { z } from 'zod';
import { CustomHttpException } from '../../../../custom.exception';
import { PlanSearch } from '../../application/search/plan-search.usecase';
import { RunSearch } from '../../application/search/run-search.usecase';
import { SEARCH_LOG_PORT, type ISearchLogPort } from '../../domain/ports';
import { RECIPES } from '../../domain/search/recipes';
import { CLARIFY_TOOL, HIGHLIGHT_TOOL, PLAN_TOOL } from '../../domain/search/turn-protocol';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

const recordId = z.string().startsWith('rec');
const orderBy = z
  .array(z.object({ field: z.string(), order: z.enum(['asc', 'desc']) }))
  .max(5)
  .optional();
const filter = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Teable filter: {conjunction:"and"|"or", filterSet:[{fieldId:<field name>, operator, value}]}'
  );
const linkRef = z.object({
  step: z.string().regex(/^s\d+$/, 'an earlier step, e.g. s1'),
  field: z.string().min(1).describe('link field name'),
});

const planInput = z.object({
  intent: searchIntentSchema.describe(RECIPES.map((r) => `${r.intent}: ${r.hint}`).join('; ')),
  summary: z.string().max(200).optional().describe('One line: what the admin wants to know'),
  anchor: z
    .object({
      table: z.string().optional().describe('Table to start from (record_lookup, action)'),
      text: z
        .string()
        .max(200)
        .optional()
        .describe('Words naming the record(s), e.g. a project name'),
      recordIds: z
        .array(recordId)
        .max(100)
        .optional()
        .describe('Known records, e.g. the option the admin picked'),
      filter,
      orderBy,
    })
    .optional(),
  steps: z
    .array(
      z.object({
        table: z.string().min(1),
        purpose: z.string().max(200).optional(),
        role: z.enum(['anchor', 'related', 'actor', 'context']).optional(),
        search: z.string().max(200).optional(),
        filter,
        orderBy,
        recordIds: z.array(recordId).max(100).optional(),
        follow: z
          .array(linkRef)
          .max(6)
          .optional()
          .describe('Follow these link fields of earlier steps'),
        reverse: z
          .array(linkRef)
          .max(6)
          .optional()
          .describe("This table's link field pointing at an earlier step's records"),
      })
    )
    .max(8)
    .optional()
    .describe('Your own steps (intent custom, or to replace a recipe); s1 is the anchor'),
  includeArchived: z
    .boolean()
    .optional()
    .describe('Also archived records (is_active off, deleted_at set)'),
});

const clarifyInput = z.object({
  question: z.string().min(1).max(500),
  reason: clarifyReasonSchema.describe(
    'intent: unclear what is asked; anchor: several records match; missing: something needed is not given'
  ),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        detail: z.string().max(300).optional(),
        recordId: recordId.optional().describe('When the option is a record the search found'),
      })
    )
    .max(6)
    .default([]),
});

const notFoundSearch = () =>
  new CustomHttpException(
    'This turn has no search yet. Call plan_search first.',
    HttpErrorCode.VALIDATION_ERROR
  );

/**
 * How the agent answers data questions (cockpit design §6): plan and run a search table by table
 * (the cockpit shows it as it goes), ask the admin when it is unclear, and point at the records
 * the answer rests on. Always on: the turn protocol depends on it.
 */
@Injectable()
export class InvestigateToolkit implements IToolkit, OnModuleInit {
  readonly id = 'investigate' as const;
  readonly title = 'Plan searches and ask';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    private readonly planner: PlanSearch,
    private readonly runner: RunSearch,
    @Inject(SEARCH_LOG_PORT) private readonly log: ISearchLogPort
  ) {
    this.tools = [
      defineTool({
        name: PLAN_TOOL,
        description:
          'Plan a search for the question and run it table by table; the cockpit shows each table and every record found as it goes. Name the intent and the anchor (the words or records the question is about); the plan follows the links between tables. Returns each step with its records (compact). Status needs_choice: several records match, call clarify; empty: nothing matched.',
        input: planInput,
        untrusted: true,
        execute: async (input, ctx) => {
          if (!ctx.threadId) throw notFoundSearch();
          const planned = await this.planner.plan({
            request: input,
            dataBaseId: ctx.profile.dataBaseId,
            runId: ctx.runId,
            threadId: ctx.threadId,
          });
          const result = await this.runner.run({
            ...planned,
            events: ctx.events,
            signal: ctx.abortSignal,
          });
          return result.forModel;
        },
      }),
      defineTool({
        name: CLARIFY_TOOL,
        description:
          'Ask the admin before going on: when the question is unclear, when several records match (give them as options with their recordId), or when something needed is missing. Shows a card with the options; your turn ends and the admin answers in their next message.',
        input: clarifyInput,
        execute: async (input, ctx) => {
          const search = await this.log.latestOfRun(ctx.runId);
          const cardOf = (id?: string) =>
            id ? search?.cards.find((c) => c.recordId === id) : undefined;
          let options = input.options;
          if (!options.length && input.reason === 'anchor' && search) {
            const anchor = search.plan.steps[0]?.id;
            options = search.cards
              .filter((c) => c.stepId === anchor)
              .slice(0, 6)
              .map((c) => ({
                label: c.title,
                detail: [c.short, c.state].filter(Boolean).join(' · '),
                recordId: c.recordId,
              }));
          }
          const part: IClarifyPart = {
            clarifyId: `clr${getRandomString(12)}`,
            question: input.question,
            reason: input.reason,
            options: options.map((o, i) => {
              const card = cardOf(o.recordId);
              return {
                id: `o${i + 1}`,
                label: o.label,
                ...(o.detail ? { detail: o.detail } : {}),
                ...(card
                  ? {
                      recordRef: {
                        tableId: card.tableId,
                        table: card.table,
                        recordId: card.recordId,
                      },
                    }
                  : {}),
              };
            }),
          };
          ctx.events?.clarify(part);
          return { ...part, note: 'Asked. Your turn ends here; the admin answers next.' };
        },
      }),
      defineTool({
        name: HIGHLIGHT_TOOL,
        description:
          'Point the cockpit at the records your answer rests on (record ids from plan_search). The board dims the rest; the admin can switch back to everything found.',
        input: z.object({
          records: z.array(recordId).min(1).max(80),
          view: searchViewSchema.optional().describe('board (default) or constellation'),
        }),
        execute: async (input, ctx) => {
          const search = await this.log.latestOfRun(ctx.runId);
          if (!search) throw notFoundSearch();
          const wanted = new Set(input.records);
          const keys = search.cards.filter((c) => wanted.has(c.recordId)).map((c) => c.key);
          const known = new Set(search.cards.map((c) => c.recordId));
          await this.log.setLens(search.id, keys);
          ctx.events?.lens({
            searchId: search.id,
            recordKeys: keys,
            ...(input.view ? { view: input.view } : {}),
          });
          const unknown = input.records.filter((id) => !known.has(id));
          return { highlighted: keys.length, ...(unknown.length ? { notInSearch: unknown } : {}) };
        },
      }),
    ];
  }

  onModuleInit() {
    this.registry.register(this);
  }
}
