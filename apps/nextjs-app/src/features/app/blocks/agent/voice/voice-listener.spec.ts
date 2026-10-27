/* eslint-disable sonarjs/no-duplicate-string */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SILENCE_MS, VoiceListener } from './voice-listener';

/** A recognition the test speaks into; `end` fires at once, as soon as it is stopped. */
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: ((ev: Event) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;
  onresult: ((ev: ISpeechRecognitionEvent) => void) | null = null;
  onerror: ((ev: ISpeechRecognitionErrorEvent) => void) | null = null;
  started = 0;
  active = false;
  langs: string[] = [];

  start() {
    if (this.active) throw new Error('already started');
    this.active = true;
    this.started++;
    this.langs.push(this.lang);
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }

  /** One result event: `[transcript, isFinal]` from `resultIndex` on. */
  say(results: [string, boolean][], resultIndex = 0) {
    const list = results.map(([transcript, isFinal]) =>
      Object.assign([{ transcript, confidence: 1 }], { isFinal })
    );
    this.onresult?.({ resultIndex, results: list } as unknown as ISpeechRecognitionEvent);
  }
  end() {
    if (!this.active) return;
    this.active = false;
    this.onend?.(new Event('end'));
  }
  fail(error: string) {
    this.onerror?.({ error } as ISpeechRecognitionErrorEvent);
    this.end();
  }
}

describe('voice listener', () => {
  let recognition: FakeRecognition;
  let sent: string[];
  let fatal: string[];
  let listener: VoiceListener;
  const create = (lang = 'en-US') =>
    new VoiceListener({
      lang,
      onSend: (text) => sent.push(text),
      onFatal: (error) => fatal.push(error),
      createRecognition: () => recognition as unknown as ISpeechRecognition,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    recognition = new FakeRecognition();
    sent = [];
    fatal = [];
    listener = create();
  });

  afterEach(() => {
    listener.dispose();
    vi.useRealTimers();
  });

  it('sends everything heard once there has been no speech for 3 seconds', () => {
    listener.start();
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    recognition.say([['show me the top customers', true]]);
    expect(listener.getSnapshot().draft).toBe('show me the top customers');
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['show me the top customers']);
    expect(listener.getSnapshot()).toMatchObject({ status: 'paused', draft: '', interim: '' });
    expect(recognition.active).toBe(false);
  });

  it('restarts the countdown on every result, interim included, and sends the sentences together', () => {
    listener.start();
    recognition.say([['first sentence.', true]]);
    vi.advanceTimersByTime(2900);
    recognition.say(
      [
        ['first sentence.', true],
        ['and the', false],
      ],
      1
    );
    expect(listener.getSnapshot().interim).toBe('and the');
    vi.advanceTimersByTime(2900);
    recognition.say(
      [
        ['first sentence.', true],
        ['and the second one.', true],
      ],
      1
    );
    vi.advanceTimersByTime(2900);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual(['first sentence. and the second one.']);
  });

  it('takes a phrase still being heard when the silence ends', () => {
    listener.start();
    recognition.say([['almost done', false]]);
    vi.advanceTimersByTime(SILENCE_MS);
    expect(sent).toEqual(['almost done']);
  });

  it('sends nothing when nothing was said', () => {
    listener.start();
    vi.advanceTimersByTime(SILENCE_MS * 4);
    expect(sent).toEqual([]);
    expect(listener.getSnapshot().deadline).toBeUndefined();
  });

  it('starts the draft with typed text', () => {
    listener.start('typed words');
    recognition.say([['and spoken ones', true]]);
    vi.advanceTimersByTime(SILENCE_MS);
    expect(sent).toEqual(['typed words and spoken ones']);
  });

  it('drops results while paused and counts down again for a kept draft on resume', () => {
    listener.start();
    recognition.say([['hello', true]]);
    listener.pause();
    expect(listener.getSnapshot()).toMatchObject({ status: 'paused', draft: 'hello' });
    recognition.say([['the agent talking', true]]);
    vi.advanceTimersByTime(SILENCE_MS * 2);
    expect(sent).toEqual([]);
    listener.resume();
    expect(recognition.started).toBe(2);
    vi.advanceTimersByTime(SILENCE_MS);
    expect(sent).toEqual(['hello']);
  });

  it('clear drops the draft and the phrase being heard', () => {
    listener.start();
    recognition.say([['oops', true]]);
    listener.clear();
    expect(listener.getSnapshot()).toMatchObject({ draft: '', interim: '', status: 'listening' });
    expect(recognition.started).toBe(2);
    vi.advanceTimersByTime(SILENCE_MS * 2);
    expect(sent).toEqual([]);
  });

  it('Send now sends at once; stop returns what was not sent', () => {
    listener.start();
    recognition.say([['quick', false]]);
    listener.sendNow();
    expect(sent).toEqual(['quick']);
    listener.resume();
    recognition.say([['unsent', true]]);
    expect(listener.stop()).toBe('unsent');
    expect(listener.getSnapshot().status).toBe('off');
    vi.advanceTimersByTime(SILENCE_MS);
    expect(sent).toEqual(['quick']);
  });

  it('restarts when the browser ends recognition by itself', () => {
    listener.start();
    recognition.end();
    expect(recognition.started).toBe(2);
    recognition.fail('no-speech');
    expect(recognition.started).toBe(3);
  });

  it('turns voice off when the mic is blocked or missing', () => {
    listener.start();
    recognition.fail('not-allowed');
    expect(fatal).toEqual(['blocked']);
    expect(listener.getSnapshot()).toMatchObject({ status: 'off', error: 'blocked' });
    expect(recognition.started).toBe(1);

    const other = create();
    other.start();
    recognition.fail('audio-capture');
    expect(fatal).toEqual(['blocked', 'no-microphone']);
    other.dispose();
  });

  it('backs off after network errors, then gives up until Retry', () => {
    listener.start();
    for (const wait of [1000, 2000, 4000]) {
      recognition.fail('network');
      const before = recognition.started;
      vi.advanceTimersByTime(wait - 1);
      expect(recognition.started).toBe(before);
      vi.advanceTimersByTime(1);
      expect(recognition.started).toBe(before + 1);
    }
    recognition.fail('network');
    expect(listener.getSnapshot()).toMatchObject({ status: 'failed', error: 'unavailable' });
    listener.resume();
    expect(listener.getSnapshot().status).toBe('listening');
    expect(recognition.started).toBe(5);
  });

  it('falls back to en-US when the language is not supported', () => {
    listener.dispose();
    listener = create('xx-YY');
    listener.start();
    recognition.fail('language-not-supported');
    expect(recognition.langs).toEqual(['xx-YY', 'en-US']);
  });

  it('fails when the browser has no speech recognition', () => {
    const none = new VoiceListener({
      lang: 'en-US',
      onSend: vi.fn(),
      createRecognition: () => undefined,
    });
    none.start();
    expect(none.getSnapshot()).toMatchObject({ status: 'failed', error: 'unavailable' });
  });
});
