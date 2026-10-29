import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UIMessageChunk } from 'ai';
import {
  createAgentUIStream,
  createUIMessageStream,
  hasToolCall,
  stepCountIs,
  ToolLoopAgent,
} from 'ai';
import { CustomHttpException } from '../../../custom.exception';
import type { IAgentProfile, IThread } from '../domain/entities';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RUN_STORE_PORT,
  type IAgentRun,
  type IAgentStorePort,
  type IModelPort,
  type IRunStatus,
  type IRunStorePort,
} from '../domain/ports';
import {
  CLARIFY_TOOL,
  startPhase,
  stepTools,
  type IToolOutcome,
} from '../domain/search/turn-protocol';
import { DeferredUiSink } from '../infrastructure/search/ui-stream-sink';
import type { IToolContext } from '../toolkits/toolkit.types';
import { ContextBuilder } from './context-builder';
import { ToolAssembler } from './tool-assembler';
import { TurnRecorder } from './turn-recorder';
import { dropUnknownTools } from './ui-parts';

/** Design §9.3: a turn never runs longer than this. */
export const TURN_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_STEPS = 25;
const stoppedMessage = 'The reply was stopped.';
const failedMessage = 'The agent hit an error. The conversation so far is saved; try again.';

/** Aborts when the run is cancelled or the turn times out (AbortSignal.any is not in our TS lib). */
export function turnSignal(cancel: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('turn timed out')), timeoutMs);
  const stop = () => {
    clearTimeout(timer);
    controller.abort(cancel.reason);
  };
  if (cancel.aborted) stop();
  else cancel.addEventListener('abort', stop, { once: true });
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

export interface ITurnInput {
  run: IAgentRun;
  thread: IThread;
  profile: IAgentProfile;
  actorUserId: string;
  focus?: IToolContext['focus'];
  /** The admin talks by voice: the prompt asks for short spoken answers. */
  voice?: boolean;
  /** The turn goes on after approvals: its plan already ran (cockpit design §6.8). */
  resumed?: boolean;
  /** The admin's latest message: ranks memories. */
  userText: string;
  controller: AbortController;
  /** Called once the stream is over, whatever happened (releases the thread lock). */
  onSettled: (outcome: { status: IRunStatus; droppedMessages: number }) => Promise<void> | void;
}

/**
 * One turn of the agent (design §10.1 steps 3-6): context, tools, ToolLoopAgent, and a UI
 * message stream whose steps are saved as they finish.
 */
@Injectable()
export class AgentRuntime {
  private readonly logger = new Logger(AgentRuntime.name);

  constructor(
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(RUN_STORE_PORT) private readonly runs: IRunStorePort,
    @Inject(MODEL_PORT) private readonly models: IModelPort,
    private readonly contextBuilder: ContextBuilder,
    private readonly toolAssembler: ToolAssembler
  ) {}

  async start(input: ITurnInput): Promise<ReadableStream<UIMessageChunk>> {
    const { run, thread, profile } = input;
    if (!profile.model) {
      throw new CustomHttpException(
        'The agent has no chat model. Choose one in the agent setup.',
        HttpErrorCode.CONFLICT
      );
    }
    const { model } = await this.models.resolve(profile.model);
    const sink = new DeferredUiSink();
    const ctx: IToolContext = {
      runId: run.id,
      actorUserId: input.actorUserId,
      threadId: thread.id,
      profile,
      focus: input.focus,
      abortSignal: input.controller.signal,
      events: sink,
    };
    const assembled = this.toolAssembler.assemble(ctx);
    const built = await this.contextBuilder.build({
      profile,
      ctx,
      toolkits: assembled.toolkits,
      userText: input.userText,
      summary: thread.summary,
      voice: input.voice,
      protocol: assembled.toolkitOf.has(CLARIFY_TOOL)
        ? profile.searchProtocol ?? 'plan'
        : undefined,
    });
    const history = dropUnknownTools(built.messages, new Set(Object.keys(assembled.tools)));
    const recorder = new TurnRecorder(
      this.store,
      this.runs,
      run,
      thread,
      profile.model,
      history.at(-1)
    );
    const agent = new ToolLoopAgent({
      model,
      instructions: built.system,
      tools: assembled.tools,
      stopWhen: [
        stepCountIs(profile.maxSteps ?? DEFAULT_MAX_STEPS),
        hasToolCall(CLARIFY_TOOL),
        () => recorder.cancelRequested(),
      ],
      prepareStep: ({ steps }) => {
        const outcomes: IToolOutcome[] = steps.flatMap((step) =>
          step.toolResults.map((r) => ({ toolName: r.toolName, output: r.output }))
        );
        const { activeTools, forceTool } = stepTools({
          mode: profile.searchProtocol ?? 'plan',
          start: startPhase(Boolean(input.resumed)),
          outcomes,
          toolkitOf: assembled.toolkitOf,
        });
        return {
          ...(activeTools ? { activeTools } : {}),
          ...(forceTool ? { toolChoice: { type: 'tool' as const, toolName: forceTool } } : {}),
        };
      },
      ...(profile.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : {}),
      ...(profile.temperature !== null ? { temperature: profile.temperature } : {}),
    });
    const { signal, dispose } = turnSignal(input.controller.signal, TURN_TIMEOUT_MS);
    void this.touchMemories(built.memoryIds);

    return createUIMessageStream({
      originalMessages: history,
      execute: async ({ writer }) => {
        sink.attach(writer);
        writer.write({
          type: 'data-run',
          data: { threadId: thread.id, runId: run.id },
          transient: true,
        });
        const stream = await createAgentUIStream({
          agent,
          uiMessages: history,
          abortSignal: signal,
          sendReasoning: true,
          onStepFinish: (step) => recorder.addUsage(step.usage),
          onError: (error) => this.onError(recorder, error, signal),
        });
        writer.merge(stream);
      },
      onStepFinish: ({ responseMessage, isContinuation }) =>
        recorder.saveAssistant(responseMessage, isContinuation),
      onFinish: async (event) => {
        let status: IRunStatus = 'failed';
        try {
          // a closed tab or the timeout stops the turn through the signal, not an abort chunk
          status = await recorder.finish({
            ...event,
            isAborted: event.isAborted || signal.aborted,
          });
        } finally {
          dispose();
          await input.onSettled({ status, droppedMessages: built.droppedMessages });
        }
      },
      onError: (error) => this.onError(recorder, error, signal),
    });
  }

  /** Text for the error part of the stream. A stop (cancel, timeout, closed tab) is not a failure. */
  private onError(recorder: TurnRecorder, error: unknown, signal: AbortSignal) {
    if (signal.aborted) return stoppedMessage;
    // the inner stream's error part comes through the outer stream a second time
    if (recorder.failed) return error instanceof Error ? error.message : String(error);
    recorder.fail(error);
    this.logger.error(`agent turn failed: ${(error as Error)?.stack ?? error}`);
    return error instanceof CustomHttpException ? error.message : failedMessage;
  }

  /** use_count / last_used_at of the memories that went into the prompt (best effort). */
  private async touchMemories(ids: string[]) {
    const now = new Date().toISOString();
    for (const id of ids) {
      try {
        const memory = await this.store.getMemory(id);
        await this.store.updateMemory(id, {
          useCount: (memory.useCount ?? 0) + 1,
          lastUsedAt: now,
        });
      } catch (error) {
        this.logger.warn(`memory ${id} usage not recorded: ${(error as Error).message}`);
      }
    }
  }
}
