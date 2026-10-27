/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it, vi } from 'vitest';
import type { IEngineChoice, IEngineId, ISpeechEngine } from './speech-queue';
import { SpeechError, SpeechQueue } from './speech-queue';
import type { ISpeechSegment } from './speech-script';

type ISpeak = (text: string, signal: AbortSignal) => Promise<void>;

const fakeEngine = (id: IEngineId, maxChars: number) => {
  const engine = {
    id,
    maxChars,
    spoken: [] as string[],
    prefetched: [] as string[],
    behaviour: (async () => undefined) as ISpeak,
    unlock: vi.fn(),
    stop: vi.fn(),
    prefetch: (text: string) => void engine.prefetched.push(text),
    speak: (text: string, signal: AbortSignal) => {
      engine.spoken.push(text);
      return engine.behaviour(text, signal);
    },
  };
  return engine;
};

/** Speech that lasts until Stop. */
const untilAborted: ISpeak = (_text, signal) =>
  new Promise((resolve) => signal.addEventListener('abort', () => resolve()));

const prose = (id: string, text: string): ISpeechSegment => ({ id, kind: 'prose', text });
const pointer = (id: string, text: string): ISpeechSegment => ({ id, kind: 'pointer', text });

const setup = (choice: IEngineChoice = 'auto') => {
  const elevenlabs = fakeEngine('elevenlabs', 300);
  const browser = fakeEngine('browser', 180);
  const onNotConfigured = vi.fn();
  const queue = new SpeechQueue({
    choice,
    engines: { elevenlabs, browser } as unknown as Record<IEngineId, ISpeechEngine>,
    onNotConfigured,
  });
  return { queue, elevenlabs, browser, onNotConfigured };
};

const idle = (queue: SpeechQueue) =>
  vi.waitFor(() => expect(queue.getSnapshot().active).toBe(false));

describe('speech queue', () => {
  it('speaks in order, joining queued prose and keeping pointers apart', async () => {
    const { queue, elevenlabs } = setup();
    queue.enqueue('m1', [
      prose('0:0:0', 'Here are your customers.'),
      prose('0:0:1', 'Acme leads.'),
      pointer('0:1', 'Please take a look at this table.'),
      prose('0:2:0', 'Want more?'),
    ]);
    await idle(queue);
    expect(elevenlabs.spoken).toEqual([
      'Here are your customers. Acme leads.',
      'Please take a look at this table.',
      'Want more?',
    ]);
    expect(elevenlabs.prefetched).toContain('Please take a look at this table.');
  });

  it('never joins past the engine length', async () => {
    const { queue, browser } = setup('browser');
    const long = 'x'.repeat(100);
    queue.enqueue('m1', [prose('a', long), prose('b', long)]);
    await idle(queue);
    expect(browser.spoken).toEqual([long, long]);
  });

  it('takes each segment once per message', async () => {
    const { queue, elevenlabs } = setup();
    const first = [prose('0:0:0', 'One.')];
    queue.enqueue('m1', first);
    await idle(queue);
    queue.enqueue('m1', [...first, prose('0:0:1', 'Two.')]);
    await idle(queue);
    queue.enqueue('m2', first);
    await idle(queue);
    expect(elevenlabs.spoken).toEqual(['One.', 'Two.', 'One.']);
  });

  it('skips segments that were on screen before voice', async () => {
    const { queue, elevenlabs } = setup();
    queue.skip('m1', [prose('0:0:0', 'Old.')]);
    queue.enqueue('m1', [prose('0:0:0', 'Old.'), prose('0:0:1', 'New.')]);
    await idle(queue);
    expect(elevenlabs.spoken).toEqual(['New.']);
  });

  it('on Auto, a 503 moves to the browser voice for the rest of the session', async () => {
    const { queue, elevenlabs, browser, onNotConfigured } = setup('auto');
    elevenlabs.behaviour = async () => {
      throw new SpeechError('not-configured');
    };
    queue.enqueue('m1', [prose('a', 'One.')]);
    await idle(queue);
    queue.enqueue('m1', [prose('b', 'Two.')]);
    await idle(queue);
    expect(elevenlabs.spoken).toEqual(['One.']);
    expect(browser.spoken).toEqual(['One.', 'Two.']);
    expect(queue.getSnapshot().engine).toBe('browser');
    expect(onNotConfigured).not.toHaveBeenCalled();
  });

  it('with ElevenLabs chosen, a 503 also tells the admin', async () => {
    const { queue, elevenlabs, onNotConfigured } = setup('elevenlabs');
    elevenlabs.behaviour = async () => {
      throw new SpeechError('not-configured');
    };
    queue.enqueue('m1', [prose('a', 'One.'), pointer('b', 'Look.')]);
    await idle(queue);
    expect(onNotConfigured).toHaveBeenCalledTimes(1);
  });

  it('with the browser voice chosen, never asks ElevenLabs', async () => {
    const { queue, elevenlabs, browser } = setup('browser');
    queue.enqueue('m1', [prose('a', 'One.')]);
    await idle(queue);
    expect(elevenlabs.spoken).toEqual([]);
    expect(browser.spoken).toEqual(['One.']);
  });

  it('says a failed ElevenLabs chunk in the browser voice, and skips what the browser fails', async () => {
    const { queue, elevenlabs, browser } = setup('auto');
    elevenlabs.behaviour = async (text) => {
      if (text === 'One.') throw new SpeechError('failed');
    };
    browser.behaviour = async (text) => {
      if (text === 'One.') throw new SpeechError('failed');
    };
    queue.enqueue('m1', [pointer('a', 'One.'), pointer('b', 'Two.')]);
    await idle(queue);
    expect(browser.spoken).toEqual(['One.']);
    expect(elevenlabs.spoken).toEqual(['One.', 'Two.']);
  });

  it('Stop ends the speech at once, and the next reply still plays', async () => {
    const { queue, elevenlabs } = setup();
    elevenlabs.behaviour = untilAborted;
    queue.enqueue('m1', [pointer('a', 'Long one.'), pointer('b', 'Never said.')]);
    expect(queue.getSnapshot().active).toBe(true);
    queue.stop();
    expect(queue.getSnapshot().active).toBe(false);
    expect(elevenlabs.stop).toHaveBeenCalled();
    elevenlabs.behaviour = async () => undefined;
    queue.enqueue('m2', [prose('a', 'Next reply.')]);
    await idle(queue);
    expect(elevenlabs.spoken).toEqual(['Long one.', 'Next reply.']);
  });

  it('waits for a tap when the browser blocks playback', async () => {
    const { queue, elevenlabs } = setup();
    let allowed = false;
    elevenlabs.behaviour = async () => {
      if (!allowed) throw new SpeechError('blocked');
    };
    queue.enqueue('m1', [pointer('a', 'First.'), pointer('b', 'Second.')]);
    await vi.waitFor(() => expect(queue.getSnapshot().blocked).toBe(true));
    expect(queue.getSnapshot().active).toBe(true);
    allowed = true;
    queue.resumeBlocked();
    expect(elevenlabs.unlock).toHaveBeenCalled();
    await idle(queue);
    expect(elevenlabs.spoken).toEqual(['First.', 'First.', 'Second.']);
    expect(queue.getSnapshot().blocked).toBe(false);
  });
});
