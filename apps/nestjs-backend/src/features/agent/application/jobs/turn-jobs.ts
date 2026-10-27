import { Inject, Injectable, Logger } from '@nestjs/common';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { IMemory, IMessage } from '../../domain/entities';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RUN_STORE_PORT,
  type IAgentStorePort,
  type IModelPort,
  type IModelPrice,
  type IRunStorePort,
  type IRunUsage,
} from '../../domain/ports';

/** What every agent job gets (design §10.1 step 7). */
export interface ITurnJobData {
  threadId: string;
  runId: string;
  actorUserId: string;
  /** History messages the last turn left out (summary job). */
  droppedMessages?: number;
}

const maxTitle = 80;
const maxSummaryInput = 30_000;
const maxExtract = 3;
const summaryBatch = 200;
/** Batches one summary job may fold in; a long thread catches up over later turns. */
const summaryRounds = 5;

export const cleanTitle = (raw: string) =>
  raw
    .replace(/^["'“”‘’\s#*]+|["'“”‘’\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxTitle);

export const costUsd = (usage: IRunUsage, price: IModelPrice) =>
  usage.inputTokens * price.input + usage.outputTokens * price.output;

/** Things that look like credentials never become memories. */
export const looksSecret = (text: string) =>
  /\b(?:sk-[A-Z0-9-]{8,}|ghp_[A-Z0-9]{8,}|xox[bp]-[A-Z0-9-]{8,}|AKIA[0-9A-Z]{12,})\b|password\s*[:=]/i.test(
    text
  );

const titleWords = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );

/** Same memory: same title, or titles that share at least 80% of their words. */
export function findDuplicate(existing: IMemory[], title: string): IMemory | undefined {
  const norm = title.trim().toLowerCase();
  const exact = existing.find((m) => m.title.trim().toLowerCase() === norm);
  if (exact) return exact;
  const a = titleWords(title);
  return existing.find((m) => {
    const b = titleWords(m.title);
    const shared = [...a].filter((w) => b.has(w)).length;
    const union = new Set([...a, ...b]).size;
    return union > 0 && shared / union >= 0.8;
  });
}

const said = (m: IMessage) => m.role === 'user' || m.role === 'assistant';
const lineOf = (m: IMessage) =>
  `${m.role === 'user' ? 'Admin' : 'Agent'}: ${(m.content ?? '').slice(0, 4000)}`;

/** The conversation as text; the newest part when it is longer than `max`. */
const transcript = (messages: IMessage[], max: number) => {
  const text = messages.filter(said).map(lineOf).join('\n\n');
  return text.length > max ? text.slice(text.length - max) : text;
};

/** The oldest messages whose transcript fits in `max` characters (at least one). */
export function fitBatch(messages: IMessage[], max: number): IMessage[] {
  const batch: IMessage[] = [];
  let used = 0;
  for (const m of messages) {
    const size = said(m) ? lineOf(m).length + 2 : 0;
    if (batch.length && used + size > max) break;
    batch.push(m);
    used += size;
  }
  return batch;
}

const extractionSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        content: z.string().max(2000),
        kind: z.enum(['fact', 'preference', 'instruction', 'entity']),
        scope: z.enum(['global', 'user']),
      })
    )
    .max(maxExtract),
});

/** The background work after a turn: title, summary, memory extraction, cost. */
@Injectable()
export class TurnJobs {
  private readonly logger = new Logger(TurnJobs.name);

  constructor(
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(RUN_STORE_PORT) private readonly runs: IRunStorePort,
    @Inject(MODEL_PORT) private readonly models: IModelPort
  ) {}

  /** The cheap model for housekeeping: small_model, else the chat model. */
  private async smallModel() {
    const profile = await this.store.getDefaultProfile();
    const ref = profile?.smallModel || profile?.model;
    if (!ref) throw new Error('no model configured for agent jobs');
    return (await this.models.resolve(ref)).model;
  }

  /** After the first turn: a short title, unless the admin renamed the thread meanwhile. */
  async title({ threadId }: ITurnJobData) {
    const thread = await this.store.getThread(threadId);
    const messages = await this.store.listMessages(threadId, { last: 4 });
    const first = messages.find((m) => m.role === 'user');
    if (!first) return;
    const placeholder = (first.content ?? '').replace(/\s+/g, ' ').slice(0, 60);
    if (thread.title !== placeholder) return;
    const { text } = await generateText({
      model: await this.smallModel(),
      system:
        'You name conversations. Reply with a title of at most 6 words. No quotes, no final punctuation.',
      prompt: transcript(messages, 4000),
    });
    const title = cleanTitle(text);
    if (title) await this.store.updateThread(threadId, { title });
  }

  /**
   * When history no longer fits: fold the dropped messages into the rolling summary, oldest first,
   * a batch that fits the model's input at a time. summaryThroughSeq only moves past what was
   * summarised, so no dropped message is left out of both the history and the summary.
   */
  async summary({ threadId, droppedMessages }: ITurnJobData) {
    if (!droppedMessages) return;
    for (let round = 0; round < summaryRounds; round++) {
      const thread = await this.store.getThread(threadId);
      const through = thread.summaryThroughSeq ?? 0;
      if (droppedMessages <= through) return;
      const pending = (
        await this.store.listMessages(threadId, {
          after: through,
          first: Math.min(droppedMessages - through, summaryBatch),
        })
      ).filter((m) => (m.seq ?? 0) <= droppedMessages);
      if (!pending.length) return;
      const batch = fitBatch(pending, maxSummaryInput);
      const { text } = await generateText({
        model: await this.smallModel(),
        system:
          'Update the running summary of a conversation between an admin and their workspace agent. Keep decisions, facts, names, ids and open questions. At most 300 words. Plain text.',
        prompt: `Summary so far:\n${thread.summary ?? '(none)'}\n\nOlder messages:\n${transcript(batch, maxSummaryInput)}`,
      });
      await this.store.updateThread(threadId, {
        summary: text.trim() || thread.summary,
        summaryThroughSeq: batch.at(-1)!.seq,
      });
    }
  }

  /** memory_mode = auto: at most 3 durable items from the last exchange; duplicates update. */
  async extractMemories({ threadId, actorUserId }: ITurnJobData) {
    const exchange = await this.store.listMessages(threadId, { last: 2 });
    if (!exchange.some((m) => m.role === 'user')) return { created: 0, updated: 0 };
    const { object } = await generateObject({
      model: await this.smallModel(),
      schema: extractionSchema,
      system: [
        'Extract at most 3 things worth remembering in later conversations: facts about the organisation, the admin’s preferences, standing instructions.',
        'Only what the admin said or clearly confirmed. Nothing temporary, nothing from documents or records, never passwords, keys or tokens.',
        'Return an empty list when nothing qualifies.',
      ].join(' '),
      prompt: transcript(exchange, 8000),
    });
    const existing = await this.store.listMemories({ take: 500 });
    let created = 0;
    let updated = 0;
    for (const item of object.items.slice(0, maxExtract)) {
      if (looksSecret(`${item.title} ${item.content}`)) continue;
      const scopeRef = item.scope === 'user' ? actorUserId : null;
      const dup = findDuplicate(
        existing.filter(
          (m) => (m.scope ?? 'global') === item.scope && (m.scopeRef ?? null) === scopeRef
        ),
        item.title
      );
      if (dup) {
        await this.store.updateMemory(dup.id, { content: item.content, kind: item.kind });
        updated++;
      } else {
        existing.push(
          await this.store.createMemory({
            title: item.title,
            content: item.content,
            kind: item.kind,
            scope: item.scope,
            scopeRef,
            source: 'agent_inferred',
            sourceThreadId: threadId,
            importance: 3,
          })
        );
        created++;
      }
    }
    return { created, updated };
  }

  /** Cost of the run from the admin's model prices, added to the thread. */
  async usage({ threadId, runId }: ITurnJobData) {
    const run = await this.runs.get(runId);
    if (!run?.usage || !run.model) return;
    const price = await this.models.price(run.model).catch(() => undefined);
    if (!price) return;
    const cost = costUsd(run.usage, price);
    const thread = await this.store.getThread(threadId);
    await this.store.updateThread(threadId, {
      costUsd: Math.round(((thread.costUsd ?? 0) + cost) * 1e6) / 1e6,
    });
    this.logger.debug(`run ${runId} cost $${cost.toFixed(6)}`);
  }
}
