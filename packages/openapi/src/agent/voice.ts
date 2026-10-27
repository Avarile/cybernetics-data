import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { registerRoute } from '../utils';
import { z } from '../zod';

/** Voice design §7.1: one spoken segment of a reply; the client splits replies into segments. */
export const AGENT_TTS_MAX_CHARS = 1000;

export const agentTtsRoSchema = z
  .object({ text: z.string().trim().min(1).max(AGENT_TTS_MAX_CHARS) })
  .strict();
export type IAgentTtsRo = z.infer<typeof agentTtsRoSchema>;

export const AGENT_TTS = '/agent/tts';

export const AgentTtsRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_TTS,
  description: 'Speak a piece of an agent reply; the response is an audio/mpeg stream',
  request: { body: { content: { 'application/json': { schema: agentTtsRoSchema } } } },
  responses: {
    200: { description: 'audio/mpeg stream' },
    503: { description: 'Text-to-speech is not configured on the server' },
  },
  tags: ['agent'],
});

/** A raw Response: the body is audio, and the caller needs the status (503 = not configured). */
export const agentTts = (text: string, signal?: AbortSignal): Promise<Response> =>
  fetch(`/api${AGENT_TTS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text } satisfies IAgentTtsRo),
    signal,
  });
