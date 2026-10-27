import { EventEmitter } from 'events';
import type { UIMessageChunk } from 'ai';
import type { Response } from 'express';
import { pumpUIMessageStream } from './ui-stream-pump';

/** A response whose socket closes after `closeAfter` writes; a closed socket never drains. */
const fakeResponse = (closeAfter = Number.POSITIVE_INFINITY) => {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: string[] = [];
  Object.assign(res, {
    destroyed: false,
    writableEnded: false,
    headers: undefined as unknown,
    writeHead: (_status: number, headers: unknown) => (res.headers = headers),
    write: (chunk: Uint8Array) => {
      if (res.destroyed) return false;
      written.push(new TextDecoder().decode(chunk));
      if (written.length >= closeAfter) {
        res.destroyed = true;
        queueMicrotask(() => res.emit('close'));
        return false;
      }
      return true;
    },
    end: () => (res.writableEnded = true),
  });
  return { res: res as unknown as Response, written, raw: res };
};

/** Text deltas; `pulled` counts how far the consumer read. */
const chunks = (n: number) => {
  const state = { pulled: 0 };
  let i = 0;
  const stream = new ReadableStream<UIMessageChunk>(
    {
      pull(controller) {
        if (i === n) return controller.close();
        state.pulled = ++i;
        controller.enqueue({ type: 'text-delta', id: 't', delta: `w${i}` });
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, state };
};

describe('pumpUIMessageStream', () => {
  it('writes server-sent events with the stream headers and ends the response', async () => {
    const { res, written, raw } = fakeResponse();
    const { stream } = chunks(3);
    await pumpUIMessageStream(res, stream, { 'x-agent-run-id': 'run1' });
    expect(raw.headers).toMatchObject({
      'content-type': 'text/event-stream',
      'x-agent-run-id': 'run1',
    });
    expect(written.join('')).toContain('"delta":"w3"');
    expect(raw.writableEnded).toBe(true);
  });

  it('reads the stream to the end after the client went away', async () => {
    const { res, written } = fakeResponse(2);
    const { stream, state } = chunks(200);
    await pumpUIMessageStream(res, stream, {});
    expect(written).toHaveLength(2);
    // the turn's onFinish runs only once the whole stream was read
    expect(state.pulled).toBe(200);
  });
});
