import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  SEARCH_LOG_PORT,
  SEARCH_READER_PORT,
  type ISearchEventSink,
  type ISearchLogPort,
  type ISearchReaderPort,
} from '../../domain/ports';
import { chooseAnchor, isExactTitle, type IAnchorHit } from '../../domain/search/anchor-choice';
import { cellText, isArchived, linkValues, projectCard } from '../../domain/search/card-projection';
import { openFirst, tallyOf } from '../../domain/search/card-tally';
import type { RelationGraph } from '../../domain/search/relation-graph';
import type { IFieldRecord, ITableSchema } from '../../domain/search/schema';
import type {
  ISearchCard,
  ISearchPlan,
  ISearchStatus,
  ISearchStep,
  IStepState,
} from '../../domain/search/search.types';

export const STEP_TIMEOUT_MS = 15_000;
export const RUN_TIMEOUT_MS = 60_000;
export const MAX_RUN_CARDS = 500;
/** Linked records read per step (more are counted, not read). */
const fetchCap = 300;
/** Full-text hits considered for an anchor. */
const anchorPool = 20;
/** Most records the model gets per step. */
const modelRecords = 30;

type IVia = NonNullable<ISearchCard['via']>;

interface IStepRead {
  records: IFieldRecord[];
  found: number;
  vias?: Map<string, IVia>;
  candidates?: IFieldRecord[];
  totals?: Record<string, number>;
}

export interface IRunInput {
  plan: ISearchPlan;
  graph: RelationGraph;
  single: boolean;
  events?: ISearchEventSink;
  signal?: AbortSignal;
  now?: Date;
  /** Characters the model's result may take; fewer records per step are listed to fit. */
  resultChars?: number;
}

/** One run's working state. */
interface IRun {
  input: IRunInput;
  now: Date;
  started: number;
  status: ISearchStatus;
  states: IStepState[];
  cards: ISearchCard[];
  read: Map<string, IFieldRecord[]>;
  shownInTable: Map<string, Set<string>>;
  totals: Record<string, Record<string, number>>;
}

export interface IRunResult {
  status: ISearchStatus;
  states: IStepState[];
  cards: ISearchCard[];
  /** What the model reads (compact, no bodies). */
  forModel: Record<string, unknown>;
}

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`took longer than ${ms / 1000} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const errorText = (error: unknown) =>
  (error instanceof HttpException || error instanceof Error ? error.message : String(error)).slice(
    0,
    300
  );

const primaryText = (table: ITableSchema, record: IFieldRecord) => {
  const primary = table.fields.find((f) => f.isPrimary) ?? table.fields[0];
  return primary ? cellText(record.fields[primary.name], 200) : '';
};

/**
 * Runs a search plan step by step (cockpit design §6.6): every step announces itself, every
 * record it finds goes out as its own card, and the log is saved after each step. An anchor that
 * is ambiguous or empty stops the run so the agent can ask or try again.
 */
@Injectable()
export class RunSearch {
  private readonly logger = new Logger(RunSearch.name);

  constructor(
    @Inject(SEARCH_READER_PORT) private readonly reader: ISearchReaderPort,
    @Inject(SEARCH_LOG_PORT) private readonly log: ISearchLogPort
  ) {}

  async run(input: IRunInput): Promise<IRunResult> {
    const { plan } = input;
    const run: IRun = {
      input,
      now: input.now ?? new Date(),
      started: Date.now(),
      status: 'running',
      states: plan.steps.map((s) => ({ stepId: s.id, status: 'pending', found: 0, shown: 0 })),
      cards: [],
      read: new Map(),
      shownInTable: new Map(),
      totals: {},
    };
    this.emitPlan(run);
    for (const [i, step] of plan.steps.entries()) {
      const state = run.states[i];
      if (run.status !== 'running') state.status = 'skipped';
      else if (input.signal?.aborted) {
        state.status = 'cancelled';
        run.status = 'cancelled';
      } else if (Date.now() - run.started > RUN_TIMEOUT_MS) {
        state.status = 'skipped';
        state.error = 'the search ran out of time';
      } else await this.runStep(run, step, state);
    }
    if (run.status === 'running') run.status = 'done';
    this.emitPlan(run);
    await this.save(run);
    return {
      status: run.status,
      states: run.states,
      cards: run.cards,
      forModel: this.forModel(run),
    };
  }

  private emitPlan(run: IRun) {
    const { plan, events } = run.input;
    events?.plan({
      searchId: plan.id,
      plan,
      states: run.states.map((s) => ({ ...s })),
      status: run.status,
    });
  }

  private save(run: IRun) {
    const id = run.input.plan.id;
    return this.log
      .save(id, { states: run.states, cards: run.cards, status: run.status })
      .catch((error) => this.logger.warn(`search ${id} not saved: ${errorText(error)}`));
  }

  private cardsOf(
    run: IRun,
    step: ISearchStep,
    table: ITableSchema,
    records: IFieldRecord[],
    vias?: Map<string, IVia>
  ) {
    return records.map((record) =>
      projectCard({ record, table, step, via: vias?.get(record.id), now: run.now })
    );
  }

  /** Sends a step's first cards, each as its own chunk; returns how many were shown. */
  private show(run: IRun, step: ISearchStep, table: ITableSchema, cards: ISearchCard[]) {
    const seen = run.shownInTable.get(table.id) ?? new Set<string>();
    run.shownInTable.set(table.id, seen);
    let shown = 0;
    for (const card of cards) {
      if (shown >= step.limit || run.cards.length >= MAX_RUN_CARDS) break;
      run.cards.push(card);
      seen.add(card.recordId);
      shown++;
      run.input.events?.hit({ searchId: run.input.plan.id, card });
    }
    return shown;
  }

  /**
   * A step's records as cards: related steps put open work first and count every state, since
   * they show only their first cards. Later steps follow the records in this order, so what they
   * reach names a shown card as its source whenever one links to it.
   */
  private stepCards(run: IRun, step: ISearchStep, table: ITableSchema, result: IStepRead) {
    const cards = this.cardsOf(run, step, table, result.records, result.vias);
    if (step.source.kind !== 'follow' && step.source.kind !== 'reverse') {
      return { cards, records: result.records };
    }
    const ordered = openFirst(cards);
    const byId = new Map(result.records.map((r) => [r.id, r]));
    return {
      cards: ordered,
      records: ordered.map((c) => byId.get(c.recordId)!),
      tally: tallyOf(ordered),
    };
  }

  private async runStep(run: IRun, step: ISearchStep, state: IStepState) {
    const { plan, graph, events } = run.input;
    const emitStep = () => events?.step({ searchId: plan.id, state: { ...state } });
    const table = graph.table(step.table.id);
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    emitStep();
    try {
      if (!table) throw new Error(`table ${step.table.name} is gone`);
      const result = await withTimeout(
        this.readStep({
          step,
          table,
          graph,
          plan,
          read: run.read,
          shownInTable: run.shownInTable,
          single: run.input.single,
        }),
        STEP_TIMEOUT_MS
      );
      if (result.candidates) {
        state.status = 'needs_choice';
        state.found = result.candidates.length;
        state.shown = this.show(
          run,
          step,
          table,
          this.cardsOf(run, step, table, result.candidates)
        );
        run.status = 'needs_choice';
      } else if (!result.records.length) {
        state.status = 'empty';
        if (step.role === 'anchor') run.status = 'empty';
      } else {
        const { cards, records, tally } = this.stepCards(run, step, table, result);
        run.read.set(step.id, records);
        state.found = result.found;
        if (tally) state.tally = tally;
        state.shown = this.show(run, step, table, cards);
        state.status = 'done';
        if (result.totals) run.totals[step.id] = result.totals;
      }
    } catch (error) {
      state.status = 'failed';
      state.error = errorText(error);
      if (step.role === 'anchor') run.status = 'failed';
    }
    state.finishedAt = new Date().toISOString();
    emitStep();
    this.emitPlan(run);
    await this.save(run);
  }

  private async readStep(input: {
    step: ISearchStep;
    table: ITableSchema;
    graph: RelationGraph;
    plan: ISearchPlan;
    read: Map<string, IFieldRecord[]>;
    shownInTable: Map<string, Set<string>>;
    single: boolean;
  }): Promise<IStepRead> {
    const { step, table, plan } = input;
    const keep = (records: IFieldRecord[]) =>
      plan.includeArchived ? records : records.filter((r) => !isArchived(r, table));
    const includeDeleted = Boolean(plan.includeArchived);
    const source = step.source;
    switch (source.kind) {
      case 'search':
        return this.anchor(
          step,
          table,
          source.text,
          source.filter,
          input.single,
          keep,
          includeDeleted
        );
      case 'records': {
        const records = await this.reader.byIds(table, source.recordIds);
        return { records, found: records.length };
      }
      case 'filter': {
        const { records, total } = await this.reader.filter(table, source.filter, {
          take: step.limit,
          orderBy: source.orderBy,
          includeDeleted,
        });
        const totals = step.totals?.length
          ? await this.reader.totals(table, step.totals, source.filter).catch(() => undefined)
          : undefined;
        const kept = keep(records);
        return {
          records: kept,
          found: Math.max(total - (records.length - kept.length), kept.length),
          totals,
        };
      }
      case 'follow':
        return this.follow(step, table, source.from, input.read, input.shownInTable, keep);
      case 'reverse':
        return this.reverse(
          step,
          table,
          input.graph,
          source.from,
          input.read,
          keep,
          includeDeleted
        );
    }
  }

  private async anchor(
    step: ISearchStep,
    table: ITableSchema,
    text: string,
    filter: unknown,
    single: boolean,
    keep: (r: IFieldRecord[]) => IFieldRecord[],
    includeDeleted: boolean
  ): Promise<IStepRead> {
    const options = { take: step.limit, includeDeleted, filter };
    const [titled, ranked] = await Promise.all([
      this.reader.titleMatches(table, text, options),
      filter ? Promise.resolve([]) : this.reader.fullText(table, text, anchorPool),
    ]);
    const rank = new Map(ranked.map((r) => [r.recordId, r.rank]));
    const titledIds = new Set(titled.map((r) => r.id));
    const more = await this.reader.byIds(
      table,
      ranked.map((r) => r.recordId).filter((id) => !titledIds.has(id))
    );
    let pool = keep([...titled, ...more]);
    if (!pool.length) pool = keep(await this.reader.quickSearch(table, text, options));
    const hits = pool
      .map((record) => {
        const title = primaryText(table, record);
        const hit: IAnchorHit = {
          recordId: record.id,
          title,
          rank: rank.get(record.id),
          exact: isExactTitle(title, text),
        };
        const score =
          (hit.exact ? 1000 : 0) + (titledIds.has(record.id) ? 100 : 0) + (hit.rank ?? 0) * 10;
        return { hit, record, score };
      })
      .sort((a, b) => b.score - a.score);
    const byId = new Map(hits.map((h) => [h.record.id, h.record]));
    const choice = chooseAnchor(
      hits.map((h) => h.hit),
      single
    );
    if (choice.kind === 'empty') return { records: [], found: 0 };
    if (choice.kind === 'needs_choice') {
      return {
        records: [],
        found: 0,
        candidates: choice.candidates.map((c) => byId.get(c.recordId)!),
      };
    }
    const records = choice.recordIds.slice(0, step.limit).map((id) => byId.get(id)!);
    return { records, found: choice.recordIds.length };
  }

  private async follow(
    step: ISearchStep,
    table: ITableSchema,
    from: { stepId: string; field: string }[],
    read: Map<string, IFieldRecord[]>,
    shownInTable: Map<string, Set<string>>,
    keep: (r: IFieldRecord[]) => IFieldRecord[]
  ): Promise<IStepRead> {
    const vias = new Map<string, IVia>();
    const already = shownInTable.get(table.id) ?? new Set<string>();
    for (const ref of from) {
      for (const record of read.get(ref.stepId) ?? []) {
        for (const linked of linkValues(record.fields[ref.field])) {
          if (vias.has(linked.id) || already.has(linked.id)) continue;
          vias.set(linked.id, { stepId: ref.stepId, recordId: record.id, field: ref.field });
        }
      }
    }
    const ids = [...vias.keys()];
    if (!ids.length) return { records: [], found: 0 };
    const fetched = await this.reader.byIds(table, ids.slice(0, fetchCap));
    const records = keep(fetched);
    return { records, found: records.length + Math.max(0, ids.length - fetchCap), vias };
  }

  private async reverse(
    step: ISearchStep,
    table: ITableSchema,
    graph: RelationGraph,
    from: { stepId: string; field: string }[],
    read: Map<string, IFieldRecord[]>,
    keep: (r: IFieldRecord[]) => IFieldRecord[],
    includeDeleted: boolean
  ): Promise<IStepRead> {
    const vias = new Map<string, IVia>();
    const records: IFieldRecord[] = [];
    for (const ref of from) {
      const sources = (read.get(ref.stepId) ?? []).map((r) => r.id);
      const field = graph.field(table, ref.field);
      if (!sources.length || !field) continue;
      const found = await this.reader.linkedTo(table, field, sources, {
        take: step.limit,
        includeDeleted,
      });
      const wanted = new Set(sources);
      for (const record of keep(found)) {
        if (vias.has(record.id)) continue;
        const source = linkValues(record.fields[field.name]).find((v) => wanted.has(v.id));
        vias.set(record.id, {
          stepId: ref.stepId,
          recordId: source?.id ?? sources[0],
          field: field.name,
        });
        records.push(record);
      }
    }
    return { records, found: records.length, vias };
  }

  /**
   * What the model reads: whole records, halving how many each step lists until the result fits
   * its budget, so it is never cut off mid-record (or without its status).
   */
  private forModel(run: IRun) {
    const budget = run.input.resultChars ?? Infinity;
    let perStep = modelRecords;
    let view = this.modelView(run, perStep);
    while (perStep > 0 && JSON.stringify(view).length > budget) {
      perStep = Math.floor(perStep / 2);
      view = this.modelView(run, perStep);
    }
    return view;
  }

  private modelView(run: IRun, perStep: number) {
    const { plan } = run.input;
    const { states, cards, totals, status } = run;
    const anchor = plan.steps[0];
    const text = anchor?.source.kind === 'search' ? anchor.source.text : anchor?.table.name;
    const next: Record<ISearchStatus, string> = {
      done: "The cockpit shows these records table by table. Answer from them and cite the records you use with highlight_records. For a record's full text, call get_records.",
      needs_choice: `Several ${anchor?.table.name} records match "${text}". Call clarify (reason anchor) with these candidates as options.`,
      empty: `Nothing in ${anchor?.table.name} matches "${text}". Try once more with other words, or ask the admin.`,
      failed:
        'The search failed at its first step; see the error. Tell the admin, or try another plan.',
      cancelled: 'The search was stopped.',
      planned: '',
      running: '',
    };
    const steps = plan.steps.map((s, i) => {
      const tally = states[i].tally;
      return {
        step: s.id,
        table: s.table.name,
        purpose: s.purpose,
        status: states[i].status,
        found: states[i].found,
        ...(states[i].error ? { error: states[i].error } : {}),
        ...(totals[s.id] ? { totals: totals[s.id] } : {}),
        ...(tally
          ? {
              byState: Object.fromEntries(
                tally.states.map((row) => [row.state || 'no state', row.count])
              ),
              ...(tally.overdue ? { overdue: tally.overdue } : {}),
              ...(tally.counted < states[i].found ? { counted: tally.counted } : {}),
            }
          : {}),
        records: cards
          .filter((c) => c.stepId === s.id)
          .slice(0, perStep)
          .map((c) => ({
            id: c.recordId,
            title: c.title,
            ...(c.state ? { state: c.state } : {}),
            ...(c.alert ? { overdue: true } : {}),
            ...(c.archived ? { archived: true } : {}),
            ...Object.fromEntries(c.fields.map((f) => [f.name, f.value])),
            ...(c.date ? { date: c.date } : {}),
            ...(c.via ? { via: `${c.via.field} of ${c.via.recordId}` } : {}),
          })),
      };
    });
    return {
      searchId: plan.id,
      status,
      intent: plan.intent,
      summary: plan.summary,
      ...(plan.missing.length ? { missing: plan.missing } : {}),
      steps,
      ...(steps.some((s) => s.records.length < s.found)
        ? {
            listed: `At most ${perStep} records per step are listed here, open work first. A step's byState counts every record it read: count from that, not from the list. Call get_records for the others.`,
          }
        : {}),
      next: next[status],
    };
  }
}
