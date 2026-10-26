import { Logger } from '@nestjs/common';
import type { UIMessage } from 'ai';
import type { IThread } from '../domain/entities';
import type { IAgentRun, IAgentStorePort, IRunStatus, IRunStorePort } from '../domain/ports';
import { pendingApprovalsOf, textOf } from './ui-parts';

interface IStepUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Persists one turn as it happens (design §10.1 steps 2 and 6): the assistant message after
 * every step, then the run's outcome, usage and the thread's counters. Storage failures are
 * logged, never thrown into the stream.
 */
export class TurnRecorder {
  private readonly logger = new Logger(TurnRecorder.name);
  private assistantId?: string;
  private readonly usage = { inputTokens: 0, outputTokens: 0, steps: 0 };
  private error?: string;

  constructor(
    private readonly store: IAgentStorePort,
    private readonly runs: IRunStorePort,
    private readonly run: IAgentRun,
    private readonly thread: IThread,
    private readonly model: string | null,
    /** The last history message: an assistant message here means a continued (resumed) turn. */
    private readonly lastOriginal?: UIMessage
  ) {}

  addUsage(usage: IStepUsage | undefined) {
    this.usage.steps += 1;
    this.usage.inputTokens += usage?.inputTokens ?? 0;
    this.usage.outputTokens += usage?.outputTokens ?? 0;
  }

  get failed() {
    return this.error !== undefined;
  }

  fail(error: unknown) {
    this.error = error instanceof Error ? error.message : String(error);
  }

  /** Stop condition: a cancel from any replica marks the run cancelled in the database. */
  async cancelRequested() {
    return (await this.runs.get(this.run.id))?.status === 'cancelled';
  }

  async saveAssistant(message: UIMessage, isContinuation: boolean) {
    if (!message.parts.length) return;
    const patch = {
      content: textOf(message.parts) || null,
      parts: JSON.stringify(message.parts),
      model: this.model,
    };
    try {
      const id =
        this.assistantId ??
        (isContinuation && this.lastOriginal?.role === 'assistant'
          ? this.lastOriginal.id
          : undefined);
      if (id) {
        await this.store.updateMessage(id, patch);
        this.assistantId = id;
      } else {
        const [created] = await this.store.appendMessages(this.thread.id, [
          { role: 'assistant', ...patch },
        ]);
        this.assistantId = created.id;
      }
    } catch (error) {
      this.logger.error(`saving the reply of run ${this.run.id} failed: ${(error as Error).stack}`);
    }
  }

  async finish(event: { responseMessage: UIMessage; isContinuation: boolean; isAborted: boolean }) {
    await this.saveAssistant(event.responseMessage, event.isContinuation);
    const pending = pendingApprovalsOf(event.responseMessage.parts);
    const cancelled = event.isAborted || (await this.cancelRequested());
    // a stop wins over the error it causes
    const status: IRunStatus = cancelled
      ? 'cancelled'
      : this.error
        ? 'failed'
        : pending.length
          ? 'awaiting_approval'
          : 'done';
    try {
      await this.runs.update(this.run.id, {
        status,
        pendingApproval: pending.length && status === 'awaiting_approval' ? pending : null,
        usage: this.usage,
        error: status === 'failed' ? this.error ?? null : null,
      });
      const thread = await this.store.getThread(this.thread.id);
      await this.store.updateThread(this.thread.id, {
        tokensIn: (thread.tokensIn ?? 0) + this.usage.inputTokens,
        tokensOut: (thread.tokensOut ?? 0) + this.usage.outputTokens,
        lastMessageAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`closing run ${this.run.id} failed: ${(error as Error).stack}`);
    }
    return status;
  }
}
