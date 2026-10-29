import { recipeFor, type IRecipe, type IRecipeLink, type IRecipeStep } from './recipes';
import type { RelationGraph } from './relation-graph';
import { systemTable, type ITableSchema } from './schema';
import type {
  ISearchIntent,
  ISearchPlan,
  ISearchStep,
  ISearchStepRole,
  IStepSource,
} from './search.types';

export const MAX_PLAN_STEPS = 8;
export const ANCHOR_LIMIT = 10;
export const LIST_ANCHOR_LIMIT = 25;
export const STEP_LIMIT = 50;
/** One-hop steps a record lookup adds after its anchor. */
const maxLookupHops = 5;

type IOrder = { field: string; order: 'asc' | 'desc' };

export interface IPlanAnchor {
  table?: string;
  text?: string;
  recordIds?: string[];
  filter?: unknown;
  orderBy?: IOrder[];
}

/** A step the model gives itself (intent `custom`, or to replace a recipe). */
export interface ICustomStep {
  table: string;
  purpose?: string;
  role?: ISearchStepRole;
  search?: string;
  filter?: unknown;
  orderBy?: IOrder[];
  recordIds?: string[];
  /** Earlier steps (`s1`…) and the link field to follow from their records. */
  follow?: { step: string; field: string }[];
  /** Earlier steps and the link field on this table that points at their records. */
  reverse?: { step: string; field: string }[];
}

export interface IPlanRequest {
  searchId: string;
  intent: ISearchIntent;
  summary?: string;
  anchor?: IPlanAnchor;
  steps?: ICustomStep[];
  includeArchived?: boolean;
}

export interface IPlanContext {
  graph: RelationGraph;
  baseId: string;
  /** Table ids never searched (search_exclude, the Agent space). */
  excluded?: Set<string>;
}

/** The request cannot become a plan; the message tells the model what to fix. */
export class PlanError extends Error {}

const linksHelp = (ctx: IPlanContext, table: ITableSchema) => {
  const links = ctx.graph.linksFrom(table);
  return links.length
    ? `${table.name} links: ${links.map((l) => `${l.field.name} → ${l.target.name}`).join(', ')}.`
    : `${table.name} has no links.`;
};

const searchable = (ctx: IPlanContext, table: ITableSchema) =>
  !systemTable.test(table.name) && !ctx.excluded?.has(table.id);

function tableOf(ctx: IPlanContext, name: string): ITableSchema {
  const table = ctx.graph.table(name);
  if (!table) {
    const names = ctx.graph.tables.filter((t) => searchable(ctx, t)).map((t) => t.name);
    throw new PlanError(`No table "${name}" in this base. Tables: ${names.join(', ')}.`);
  }
  if (!searchable(ctx, table)) throw new PlanError(`The table "${table.name}" is not searched.`);
  return table;
}

function anchorSource(anchor: IPlanAnchor | undefined): IStepSource {
  if (anchor?.recordIds?.length) return { kind: 'records', recordIds: anchor.recordIds };
  const text = anchor?.text?.trim();
  if (text) return { kind: 'search', text: text.slice(0, 200), filter: anchor?.filter };
  if (anchor?.filter) return { kind: 'filter', filter: anchor.filter, orderBy: anchor.orderBy };
  throw new PlanError('Give the anchor: anchor.text, anchor.filter or anchor.recordIds.');
}

/**
 * Builds the plan of a question (cockpit design §6.5): a recipe resolved against the live schema
 * (what it can't find is skipped and listed in `missing`), or the model's own steps, validated.
 */
export function buildPlan(req: IPlanRequest, ctx: IPlanContext): ISearchPlan {
  const recipe = recipeFor(req.intent);
  const plan: ISearchPlan = {
    id: req.searchId,
    intent: req.intent,
    summary: '',
    baseId: ctx.baseId,
    steps: [],
    missing: [],
    ...(req.includeArchived ? { includeArchived: true } : {}),
  };
  if (req.steps?.length) plan.steps = customSteps(req, ctx);
  else if (!recipe || !recipe.steps.length) {
    throw new PlanError(`Intent ${req.intent} needs steps: give them in "steps".`);
  } else recipeSteps(recipe, req, ctx, plan);

  const anchor = plan.steps[0];
  const what =
    anchor.source.kind === 'search' ? ` "${anchor.source.text}"` : ` in ${anchor.table.name}`;
  plan.summary = (req.summary?.trim() || `${req.intent.replace(/_/g, ' ')}${what}`).slice(0, 200);
  return plan;
}

function recipeSteps(recipe: IRecipe, req: IPlanRequest, ctx: IPlanContext, plan: ISearchPlan) {
  const [first, ...rest] = recipe.steps;
  const wanted = req.anchor?.table?.trim();
  if (first.table && wanted && ctx.graph.table(wanted)?.id !== ctx.graph.table(first.table)?.id) {
    throw new PlanError(
      `${recipe.intent} starts from ${first.table}. For another table use record_lookup or custom.`
    );
  }
  const anchorName = first.table || wanted;
  if (!anchorName) throw new PlanError(`Name the table to search in anchor.table.`);
  const anchorTable = tableOf(ctx, anchorName);
  const source = anchorSource(req.anchor);
  plan.steps.push({
    id: first.id,
    table: { id: anchorTable.id, name: anchorTable.name },
    role: 'anchor',
    purpose: first.purpose,
    source,
    limit: source.kind === 'filter' || !recipe.single ? LIST_ANCHOR_LIMIT : ANCHOR_LIMIT,
    ...(first.totals ? { totals: first.totals } : {}),
  });

  if (recipe.intent === 'record_lookup') {
    lookupHops(anchorTable, ctx, plan);
    return;
  }
  for (const step of rest) {
    const resolved = recipeStep(step, ctx, plan);
    if (resolved) plan.steps.push(resolved);
  }
}

/** A later recipe step with its links resolved, or undefined when nothing leads to it. */
function recipeStep(step: IRecipeStep, ctx: IPlanContext, plan: ISearchPlan) {
  const table = ctx.graph.table(step.table);
  if (!table || !searchable(ctx, table)) {
    plan.missing.push(step.table);
    return undefined;
  }
  const resolve = (refs: IRecipeLink[] | undefined, reverse: boolean) =>
    (refs ?? []).flatMap(([stepId, field]) => {
      const from = plan.steps.find((s) => s.id === stepId);
      if (!from) return [];
      const holder = ctx.graph.table(reverse ? table.id : from.table.id)!;
      const link = ctx.graph.link(holder, field);
      if (!link || link.target.id !== (reverse ? from.table.id : table.id)) {
        plan.missing.push(`${holder.name}.${field}`);
        return [];
      }
      return [{ stepId, field: link.field.name }];
    });
  const follow = resolve(step.follow, false);
  const reverse = resolve(step.reverse, true);
  let source: IStepSource;
  if (follow.length) source = { kind: 'follow', from: follow };
  else if (reverse.length) source = { kind: 'reverse', from: reverse };
  else return undefined;
  const out: ISearchStep = {
    id: step.id,
    table: { id: table.id, name: table.name },
    role: step.role,
    purpose: step.purpose,
    source,
    limit: STEP_LIMIT,
    ...(step.totals ? { totals: step.totals } : {}),
  };
  return out;
}

/** A record lookup's second steps: one per table the anchor links to. */
function lookupHops(anchor: ITableSchema, ctx: IPlanContext, plan: ISearchPlan) {
  const byTarget = new Map<string, { target: ITableSchema; fields: string[] }>();
  for (const link of ctx.graph.linksFrom(anchor)) {
    if (!searchable(ctx, link.target)) continue;
    const entry = byTarget.get(link.target.id) ?? { target: link.target, fields: [] };
    entry.fields.push(link.field.name);
    byTarget.set(link.target.id, entry);
  }
  [...byTarget.values()].slice(0, maxLookupHops).forEach(({ target, fields }, i) => {
    plan.steps.push({
      id: `s${i + 2}`,
      table: { id: target.id, name: target.name },
      role: 'related',
      purpose: `${target.name} linked from ${anchor.name}`,
      source: { kind: 'follow', from: fields.map((field) => ({ stepId: 's1', field })) },
      limit: STEP_LIMIT,
    });
  });
}

/** The links of a custom step, checked against the schema; problems say what to fix. */
function customLinks(
  id: string,
  table: ITableSchema,
  list: { step: string; field: string }[],
  reverse: boolean,
  done: ISearchStep[],
  ctx: IPlanContext,
  problems: string[]
) {
  return list.flatMap(({ step, field }) => {
    const from = done.find((s) => s.id === step);
    if (!from) {
      problems.push(`${id}: "${step}" is not an earlier step.`);
      return [];
    }
    const holder = reverse ? table : ctx.graph.table(from.table.id)!;
    const link = ctx.graph.link(holder, field);
    if (!link || link.target.id !== (reverse ? from.table.id : table.id)) {
      const want = reverse
        ? `${table.name} → ${from.table.name}`
        : `${from.table.name} → ${table.name}`;
      problems.push(
        `${id}: ${holder.name}.${field} is not a link ${want}. ${linksHelp(ctx, holder)}`
      );
      return [];
    }
    return [{ stepId: step, field: link.field.name }];
  });
}

/** How a custom step is reached, or a problem. */
function customSource(
  raw: ICustomStep,
  i: number,
  req: IPlanRequest,
  links: (list: { step: string; field: string }[], reverse: boolean) => IStepLinks
): IStepSource | string {
  if (raw.follow?.length) return { kind: 'follow', from: links(raw.follow, false) };
  if (raw.reverse?.length) return { kind: 'reverse', from: links(raw.reverse, true) };
  if (i > 0 && !raw.search && !raw.filter && !raw.recordIds?.length) {
    return 'say how it is reached (search, filter, recordIds, follow or reverse).';
  }
  try {
    return anchorSource(i === 0 ? { ...req.anchor, ...pick(raw) } : pick(raw));
  } catch (error) {
    return (error as Error).message;
  }
}

type IStepLinks = { stepId: string; field: string }[];

function customSteps(req: IPlanRequest, ctx: IPlanContext): ISearchStep[] {
  const input = req.steps ?? [];
  if (input.length > MAX_PLAN_STEPS) throw new PlanError(`At most ${MAX_PLAN_STEPS} steps.`);
  const steps: ISearchStep[] = [];
  const problems: string[] = [];
  input.forEach((raw, i) => {
    const id = `s${i + 1}`;
    let table: ITableSchema;
    try {
      table = tableOf(ctx, raw.table);
    } catch (error) {
      problems.push(`${id}: ${(error as Error).message}`);
      return;
    }
    const source = customSource(raw, i, req, (list, reverse) =>
      customLinks(id, table, list, reverse, steps, ctx, problems)
    );
    if (typeof source === 'string') {
      problems.push(`${id}: ${source}`);
      return;
    }
    if ((source.kind === 'follow' || source.kind === 'reverse') && !source.from.length) return;
    steps.push({
      id,
      table: { id: table.id, name: table.name },
      role: raw.role ?? (i === 0 ? 'anchor' : 'related'),
      purpose: raw.purpose?.slice(0, 200) || (i === 0 ? 'the records asked about' : table.name),
      source,
      limit: i === 0 ? LIST_ANCHOR_LIMIT : STEP_LIMIT,
    });
  });
  if (problems.length) throw new PlanError(problems.join(' '));
  if (!steps.length) throw new PlanError('The plan has no steps.');
  return steps;
}

const pick = (raw: ICustomStep): IPlanAnchor => ({
  ...(raw.search ? { text: raw.search } : {}),
  ...(raw.filter ? { filter: raw.filter } : {}),
  ...(raw.orderBy ? { orderBy: raw.orderBy } : {}),
  ...(raw.recordIds?.length ? { recordIds: raw.recordIds } : {}),
});
