import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Action } from '@teable/core';
import { Task } from '@teable/openapi';
import type { IAiGenerateRo } from '@teable/openapi';
import type { ModelMessage } from 'ai';
import { generateText, streamText } from 'ai';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { AiDataContextService } from '../../ai-data/ai-data-context.service';
import { AiDataService } from '../../ai-data/ai-data.service';
import { PermissionService } from '../../auth/permission.service';
import { ChatFileService } from '../../chat-file/chat-file.service';
import { runGeneralInfoAgent } from '../agents/general-agents';
import type { AgentInput } from '../agents/general-agents';
import { runIngestionAgent } from '../agents/ingestion-agent';
import { getTaskModelKey } from '../util';
import { AiConfigService } from './ai-config.service';
import { MastraClientService } from './mastra-client.service';
import { ModelCapabilityService } from './model-capability.service';
import { ModelResolverService } from './model-resolver.service';

type IDataContext = { token: string };

// Record-level write permissions; holding any one of these makes the caller a writer.
const WRITE_ACTIONS: Action[] = ['record|create', 'record|update', 'record|delete'];
// Mastra agents the backend will route to. Anything else is rejected before the
// agentId reaches the Mastra URL path.
const KNOWN_MASTRA_AGENTS = new Set([
  'knowledge-manager-non-rag',
  'knowledge-manager-rag',
  'knowledge-manager-reactive',
]);
// Mastra agents whose toolset can mutate data and therefore require write permission.
// (The RAG agent's ingest tools are a known residual — gating them per-tool inside
// the Mastra service is tracked as a follow-up; see the hardening plan.)
const WRITE_CAPABLE_MASTRA_AGENTS = new Set([
  'knowledge-manager-non-rag',
  'knowledge-manager-reactive',
]);

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly aiConfigService: AiConfigService,
    private readonly modelResolverService: ModelResolverService,
    private readonly modelCapabilityService: ModelCapabilityService,
    private readonly chatFileService: ChatFileService,
    private readonly mastraClientService: MastraClientService,
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>,
    private readonly aiDataService: AiDataService,
    private readonly aiDataContextService: AiDataContextService
  ) {}

  /** Resolve whether the current caller may mutate records in this base. */
  private async resolveCanWrite(baseId: string): Promise<boolean> {
    const accessTokenId = this.cls.get('accessTokenId');
    const permissions = await this.permissionService.getPermissions(baseId, accessTokenId);
    return WRITE_ACTIONS.some((action) => permissions.includes(action));
  }

  /** H2 — a thread may only be used by the resource (user) that owns it. */
  private async assertThreadOwnership(
    threadId: string,
    resourceId: string,
    agentId: string
  ): Promise<void> {
    const thread = await this.mastraClientService.getThread(threadId, agentId);
    // null = thread does not exist yet; Mastra will create it scoped to resourceId.
    if (thread && thread.resourceId !== resourceId) {
      throw new ForbiddenException('Thread does not belong to the current user');
    }
  }

  // ── Mastra path ──────────────────────────────────────────────────────────────

  /**
   * Signed user context for the Mastra tools' calls back into the ai-data endpoint.
   * It lives for one chat turn: releaseDataContext() revokes it, so it cannot be
   * replayed afterwards. Undefined while the feature is not configured.
   */
  private async issueDataContext(userId: string, baseId: string) {
    if (!this.aiDataContextService.enabled) return undefined;
    return this.aiDataContextService.issue(userId, baseId);
  }

  /**
   * Mastra requestContext for the agent's tools: the user's data token (when the
   * ai-data endpoint is enabled) and whether the user may write in this base, which
   * gates the RAG ingest and index tools.
   */
  private toRequestContext(dataContext: IDataContext | undefined, canWrite: boolean) {
    return {
      requestContext: {
        canWrite,
        ...(dataContext ? { aiDataContext: dataContext.token } : {}),
      },
    };
  }

  private async releaseDataContext(dataContext: IDataContext | undefined) {
    if (!dataContext) return;
    try {
      await this.aiDataContextService.revoke(dataContext.token);
    } catch (err) {
      this.logger.error(`Failed to revoke AI data context: ${(err as Error).message}`);
    }
  }

  private async generateStreamViaMastra(
    baseId: string,
    aiGenerateRo: IAiGenerateRo,
    response: Response,
    canWrite: boolean
  ): Promise<void> {
    const { agentId, threadId: _threadId, resourceId, prompt, messages, fileTokens } = aiGenerateRo;

    // Abort the upstream Mastra request when the client disconnects (M1).
    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    response.on('close', onClose);
    let dataContext: IDataContext | undefined;

    try {
      dataContext = await this.issueDataContext(resourceId!, baseId);
      let resolvedThreadId = _threadId;
      let isNewThread = false;

      if (!resolvedThreadId) {
        const thread = await this.mastraClientService.createThread(resourceId!, agentId!);
        resolvedThreadId = thread.id;
        isNewThread = true;
      }

      const input: {
        messages?: { role: 'user' | 'assistant'; content: string }[];
        prompt?: string;
      } = messages?.length
        ? {
            messages: (await this.injectFileContextToMessages(messages, fileTokens)) as {
              role: 'user' | 'assistant';
              content: string;
            }[],
          }
        : { prompt: await this.injectFileContext(prompt ?? '', fileTokens) };
      const body = { ...input, ...this.toRequestContext(dataContext, canWrite) };

      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(isNewThread ? { 'X-Thread-Id': resolvedThreadId } : {}),
      });

      // Mastra agents have no reasoning section — emit the separator immediately
      response.write('\x00');

      let totalText = 0;
      for await (const chunk of this.mastraClientService.streamAgent(
        agentId!,
        body,
        resolvedThreadId,
        resourceId!,
        abortController.signal
      )) {
        if (chunk) {
          totalText += chunk.length;
          response.write(chunk);
        }
      }

      if (totalText === 0) {
        response.write('The agent completed but produced no output. Please try again.');
      }

      response.end();
    } catch (err) {
      // Client disconnected — the abort is expected, nothing to send.
      if (abortController.signal.aborted) return;
      if (!response.headersSent) throw err;
      // Surface the failure instead of an empty stream (M2); keep details in logs only.
      this.logger.error(`[generateStreamViaMastra] Error: ${(err as Error).message}`);
      try {
        response.write('\n\n[error] The assistant encountered an error. Please try again.');
      } catch {
        /* response already closed */
      }
      response.end();
    } finally {
      response.off('close', onClose);
      await this.releaseDataContext(dataContext);
    }
  }

  // ── File context helpers ──────────────────────────────────────────────────────

  private async injectFileContext(
    prompt: string,
    fileTokens: string[] | undefined
  ): Promise<string> {
    if (!fileTokens?.length) return prompt;
    const context = await this.chatFileService.buildFileContext(fileTokens);
    if (!context) return prompt;
    return `<file_context>\n${context}\n</file_context>\n\n${prompt}`;
  }

  private async injectFileContextToMessages(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    fileTokens: string[] | undefined
  ): Promise<ModelMessage[]> {
    if (!fileTokens?.length) return messages as ModelMessage[];
    const context = await this.chatFileService.buildFileContext(fileTokens);
    if (!context) return messages as ModelMessage[];

    const result: Array<{ role: 'user' | 'assistant'; content: string }> = [...messages];
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'user') {
        result[i] = {
          role: 'user',
          content: `${result[i].content}\n\n<file_context>\n${context}\n</file_context>`,
        };
        break;
      }
    }
    return result as ModelMessage[];
  }

  async generateStream(
    baseId: string,
    aiGenerateRo: IAiGenerateRo,
    response: Response
  ): Promise<void> {
    const userId = this.cls.get('user').id;
    const canWrite = await this.resolveCanWrite(baseId);

    // Route to Mastra when an agentId is supplied. The memory scope (resourceId)
    // is derived from the authenticated session, never trusted from the client (H1).
    if (aiGenerateRo.agentId && userId) {
      if (!KNOWN_MASTRA_AGENTS.has(aiGenerateRo.agentId)) {
        throw new BadRequestException(`Unknown agent: ${aiGenerateRo.agentId}`);
      }
      if (WRITE_CAPABLE_MASTRA_AGENTS.has(aiGenerateRo.agentId) && !canWrite) {
        throw new ForbiddenException(
          'You do not have write access to use this agent on this base.'
        );
      }
      if (aiGenerateRo.threadId) {
        await this.assertThreadOwnership(aiGenerateRo.threadId, userId, aiGenerateRo.agentId);
      }
      return this.generateStreamViaMastra(
        baseId,
        { ...aiGenerateRo, resourceId: userId },
        response,
        canWrite
      );
    }

    // Abort the model/agent stream when the client disconnects (M1).
    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    response.on('close', onClose);

    try {
      const {
        prompt,
        messages,
        fileTokens,
        modelKey: _modelKey,
        task = Task.Coding,
      } = aiGenerateRo;
      const config = await this.aiConfigService.getAIConfig(baseId);
      const modelKey = _modelKey ?? getTaskModelKey(config, task);
      if (!modelKey) throw new Error('Model key is not set');

      const modelInstance = await this.modelResolverService.getModelInstance(
        modelKey,
        config.llmProviders
      );

      // Only use the tool-calling agent when the model explicitly supports tool use.
      // Sending tools to a model that doesn't support them causes a 500 from the gateway.
      const tags = await this.modelCapabilityService.getModelTags(modelKey, config.llmProviders);
      const supportsTools = tags.includes('tool-use');

      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });

      if (supportsTools) {
        let input: AgentInput;
        if (messages?.length) {
          input = { messages: await this.injectFileContextToMessages(messages, fileTokens) };
        } else {
          input = { prompt: await this.injectFileContext(prompt ?? '', fileTokens) };
        }

        const result = await runGeneralInfoAgent(
          modelInstance,
          input,
          { baseId, aiData: this.aiDataService, canWrite },
          abortController.signal
        );

        // Stream reasoning text as-is; replace the [ANSWER] marker with \x00 so the
        // client can split the response into a collapsible reasoning section and the
        // visible final answer.
        const ANSWER_MARKER = '[ANSWER]\n';
        let buffer = '';
        let separatorEmitted = false;
        let totalText = 0;

        for await (const chunk of result.textStream) {
          if (!chunk) continue;

          if (separatorEmitted) {
            totalText += chunk.length;
            response.write(chunk);
            continue;
          }

          buffer += chunk;
          const markerIdx = buffer.indexOf(ANSWER_MARKER);

          if (markerIdx !== -1) {
            const reasoning = buffer.slice(0, markerIdx);
            if (reasoning) response.write(reasoning);
            response.write('\x00');
            separatorEmitted = true;
            const answer = buffer.slice(markerIdx + ANSWER_MARKER.length);
            if (answer) {
              totalText += answer.length;
              response.write(answer);
            }
            buffer = '';
          } else {
            // Hold back enough to detect a partial marker; flush the safe prefix
            const safeLength = Math.max(0, buffer.length - ANSWER_MARKER.length + 1);
            if (safeLength > 0) {
              response.write(buffer.slice(0, safeLength));
              buffer = buffer.slice(safeLength);
            }
          }
        }

        // Flush any remaining buffer (marker never appeared → treat all as answer)
        if (!separatorEmitted) {
          response.write('\x00');
        }
        if (buffer) {
          totalText += buffer.length;
          response.write(buffer);
        }

        // The agent completed all tool calls but produced no text response.
        if (totalText === 0) {
          this.logger.warn(
            '[generateStream] Agent produced 0 text — falling back to direct streamText'
          );
          const lastUserContent = messages?.length
            ? messages.findLast((m) => m.role === 'user')?.content ?? prompt ?? ''
            : prompt ?? '';
          const fallbackResult = streamText({
            model: modelInstance,
            system:
              'You are a helpful assistant for a data centre management system. ' +
              'Answer the user based on what they asked. If you cannot look up live data, ' +
              'tell them exactly what went wrong and what they should try instead.',
            prompt: String(lastUserContent),
            abortSignal: abortController.signal,
          });
          for await (const chunk of fallbackResult.textStream) {
            if (chunk) response.write(chunk);
          }
        }
      } else {
        let streamInput: Parameters<typeof streamText>[0];
        if (messages?.length) {
          const hydratedMessages = await this.injectFileContextToMessages(messages, fileTokens);
          streamInput = { model: modelInstance, messages: hydratedMessages };
        } else {
          streamInput = {
            model: modelInstance,
            prompt: await this.injectFileContext(prompt ?? '', fileTokens),
          };
        }

        const result = streamText({ ...streamInput, abortSignal: abortController.signal });
        for await (const chunk of result.textStream) {
          if (chunk) response.write(chunk);
        }
      }

      response.end();
    } catch (err) {
      // Client disconnected — abort is expected, nothing to send.
      if (abortController.signal.aborted) return;
      if (!response.headersSent) throw err;
      this.logger.error(`[generateStream] Error after headers sent: ${(err as Error).message}`);
      try {
        response.write('\n\n[error] The assistant encountered an error. Please try again.');
      } catch {
        /* response already closed */
      }
      response.end();
    } finally {
      response.off('close', onClose);
    }
  }

  async ingestStream(
    baseId: string,
    files: { buffer: Buffer; mimetype: string; originalname: string }[],
    targetTable: string,
    description: string | undefined,
    response: Response
  ): Promise<void> {
    // Ingestion creates records — require write permission (H3).
    if (!(await this.resolveCanWrite(baseId))) {
      throw new ForbiddenException('You do not have write access to ingest data into this base.');
    }

    // Abort the ingestion agent when the client disconnects (M1).
    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    response.on('close', onClose);

    try {
      const config = await this.aiConfigService.getAIConfig(baseId);
      const modelKey = getTaskModelKey(config, Task.Coding);
      if (!modelKey) throw new Error('Model key is not set');

      const modelInstance = await this.modelResolverService.getModelInstance(
        modelKey,
        config.llmProviders
      );

      const fileParts = await Promise.all(
        files.map(async (f) => {
          const text = await this.chatFileService.extractTextFromBuffer(f.buffer, f.mimetype);
          return text ? `--- File: ${f.originalname} ---\n${text}` : null;
        })
      );
      const fileContext = fileParts.filter(Boolean).join('\n\n');

      const descriptionLine = description ? `\nAdditional instructions: ${description}` : '';
      const prompt =
        `Ingest the following file content into the table named "${targetTable}".${descriptionLine}\n\n` +
        `<file_context>\n${fileContext}\n</file_context>`;

      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });

      const result = await runIngestionAgent(
        modelInstance,
        { prompt },
        { baseId, aiData: this.aiDataService, canWrite: true },
        abortController.signal
      );

      let totalText = 0;
      for await (const chunk of result.textStream) {
        if (chunk) {
          totalText += chunk.length;
          response.write(chunk);
        }
      }
      if (totalText === 0) {
        response.write('Ingestion completed but the agent produced no output. Please try again.');
      }

      response.end();
    } catch (err) {
      if (abortController.signal.aborted) return;
      if (!response.headersSent) throw err;
      this.logger.error(`[ingestStream] Error after headers sent: ${(err as Error).message}`);
      try {
        response.write('\n\n[error] Ingestion failed. Please try again.');
      } catch {
        /* response already closed */
      }
      response.end();
    } finally {
      response.off('close', onClose);
    }
  }

  async generateText(baseId: string, aiGenerateRo: IAiGenerateRo) {
    const { prompt, modelKey: _modelKey, task = Task.Coding } = aiGenerateRo;
    const config = await this.aiConfigService.getAIConfig(baseId);
    const modelKey = _modelKey ?? getTaskModelKey(config, task);
    if (!modelKey) throw new Error('Model key is not set');
    const modelInstance = await this.modelResolverService.getModelInstance(
      modelKey,
      config.llmProviders
    );

    if (prompt === undefined) {
      throw new Error('prompt is required for text generation');
    }

    const { text } = await generateText({
      model: modelInstance,
      prompt,
    });
    return text;
  }
}
