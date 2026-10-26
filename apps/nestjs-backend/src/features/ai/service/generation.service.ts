import { Injectable, Logger } from '@nestjs/common';
import { Task } from '@teable/openapi';
import type { IAiGenerateRo } from '@teable/openapi';
import type { ModelMessage } from 'ai';
import { generateText, streamText } from 'ai';
import type { Response } from 'express';
import { ChatFileService } from '../../chat-file/chat-file.service';
import { getTaskModelKey } from '../util';
import { AiConfigService } from './ai-config.service';
import { ModelResolverService } from './model-resolver.service';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly aiConfigService: AiConfigService,
    private readonly modelResolverService: ModelResolverService,
    private readonly chatFileService: ChatFileService
  ) {}

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
    // Abort the model stream when the client disconnects (M1).
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

      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });

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
