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

const transcript = (messages: IMessage[], max: number) => {
  const lines = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Admin' : 'Agent'}: ${(m.content ?? '').slice(0, 4000)}`);
  const text = lines.join('\n\n');
  return text.length > max ? text.slice(text.length - max) : text;
};

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

  /** When history no longer fits: fold the dropped messages into the rolling summary. */
  async summary({ threadId, droppedMessages }: ITurnJobData) {
    if (!droppedMessages) return;
    const thread = await this.store.getThread(threadId);
    const all = await this.store.listMessages(threadId, { last: 200 });
    const old = all.slice(0, Math.min(droppedMessages, all.length));
    if (!old.length) return;
    const { text } = await generateText({
      model: await this.smallModel(),
      system:
        'Update the running summary of a conversation between an admin and their workspace agent. Keep decisions, facts, names, ids and open questions. At most 300 words. Plain text.',
      prompt: `Summary so far:\n${thread.summary ?? '(none)'}\n\nOlder messages:\n${transcript(old, maxSummaryInput)}`,
    });
    if (text.trim()) await this.store.updateThread(threadId, { summary: text.trim() });
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
