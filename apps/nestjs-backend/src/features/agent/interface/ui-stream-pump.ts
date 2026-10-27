import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS, type UIMessageChunk } from 'ai';
import type { Response } from 'express';

const open = (res: Response) => !res.destroyed && !res.writableEnded;

/** Resolves on `drain`, or when the response closes (a closed socket never drains). */
const drained = (res: Response) =>
  new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });

/**
 * Writes a UI message stream to the response as server-sent events, and always reads the stream
 * to its end, also after the client went away (current-design §7 E1). The turn records its result
 * and releases the thread only when the stream finishes; `pipeUIMessageStreamToResponse` waits
 * for a `drain` that a closed socket never emits, which left the run and the thread lock hanging.
 */
export async function pumpUIMessageStream(
  res: Response,
  stream: ReadableStream<UIMessageChunk>,
  headers: Record<string, string>
) {
  res.writeHead(200, { ...UI_MESSAGE_STREAM_HEADERS, ...headers });
  const reader = stream
    .pipeThrough(new JsonToSseTransformStream())
    .pipeThrough(new TextEncoderStream())
    .getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (open(res) && !res.write(value)) await drained(res);
    }
  } finally {
    if (open(res)) res.end();
  }
}
