import { MockLanguageModelV3 } from 'ai/test';
import type { ChatFileService } from '../../chat-file/chat-file.service';
import type { AiConfigService } from './ai-config.service';
import { GenerationService } from './generation.service';
import type { ModelResolverService } from './model-resolver.service';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function setup(fileContext: string | null = null) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'text-start', id: 't' });
            c.enqueue({ type: 'text-delta', id: 't', delta: 'Hello ' });
            c.enqueue({ type: 'text-delta', id: 't', delta: 'there' });
            c.enqueue({ type: 'text-end', id: 't' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
            c.close();
          },
        }),
      };
    },
  });
  const service = new GenerationService(
    { getAIConfig: async () => ({ llmProviders: [] }) } as unknown as AiConfigService,
    { getModelInstance: async () => model } as unknown as ModelResolverService,
    { buildFileContext: async () => fileContext } as unknown as ChatFileService
  );
  const written: string[] = [];
  const response = {
    headersSent: false,
    writeHead: vi.fn(),
    write: (chunk: string) => written.push(chunk),
    end: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { service, response, written, prompts };
}

describe('GenerationService.generateStream', () => {
  it('streams the model text for a prompt', async () => {
    const s = setup();
    await s.service.generateStream(
      'bse1',
      { prompt: 'Say hi', modelKey: 'openai@gpt@p' },
      s.response as never
    );
    expect(s.written.join('')).toBe('Hello there');
    expect(s.response.end).toHaveBeenCalled();
  });

  it('puts chat file text in front of the prompt', async () => {
    const s = setup('--- File: a.txt ---\nQ3 numbers');
    await s.service.generateStream(
      'bse1',
      { prompt: 'Summarise', modelKey: 'openai@gpt@p', fileTokens: ['tok'] },
      s.response as never
    );
    expect(JSON.stringify(s.prompts[0])).toContain('Q3 numbers');
  });
});
