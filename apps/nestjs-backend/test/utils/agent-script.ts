/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Scripted language models for agent e2e tests: each streamed step plays the next script.
 */
import type { UIMessageChunk } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

export type IScript = unknown[] | 'throw' | 'slow';
export const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
export const say = (text: string): unknown[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
export const call = (
  toolName: string,
  input: object,
  toolCallId = `call-${toolName}`
): unknown[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];

/** A model that plays the scripts in order, one per step. */
export function scriptedModel(scripts: IScript[]) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    // background jobs: JSON for memory extraction, plain text for titles and summaries
    doGenerate: async (options) => ({
      content: [
        {
          type: 'text',
          text:
            options.responseFormat?.type === 'json'
              ? JSON.stringify({
                  items: [
                    {
                      title: 'Invoices are approved by Dana',
                      content: 'Dana in finance approves every invoice',
                      kind: 'fact',
                      scope: 'global',
                    },
                  ],
                })
              : 'Invoice approvals',
        },
      ],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
    doStream: async (options) => {
      prompts.push(options.prompt);
      const script = scripts.shift() ?? say('(no more script)');
      if (script === 'throw') throw new Error('provider is down');
      if (script === 'slow') {
        let i = 0;
        let timer: NodeJS.Timeout;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            const tick = () => {
              if (options.abortSignal?.aborted) {
                controller.error(options.abortSignal.reason ?? new Error('aborted'));
                return;
              }
              controller.enqueue({ type: 'text-delta', id: 't', delta: `w${i++} ` });
              timer = setTimeout(tick, 20);
            };
            tick();
          },
          cancel() {
            clearTimeout(timer);
          },
        });
        return { stream };
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of script) controller.enqueue(chunk as never);
            controller.close();
          },
        }),
      };
    },
  });
  return { model, prompts };
}

export async function drain(stream: ReadableStream<UIMessageChunk>, stopAfter?: number) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    if (stopAfter && chunks.length >= stopAfter) {
      reader.releaseLock();
      return { chunks, rest: stream };
    }
  }
  return { chunks, rest: undefined };
}
