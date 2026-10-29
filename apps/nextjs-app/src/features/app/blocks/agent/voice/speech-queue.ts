import type { IEngineChoice, IEngineId } from '../model/voice';
import type { ISpeechSegment } from './speech-script';

export type { IEngineChoice, IEngineId };

/** not-configured: ElevenLabs has no key (503). blocked: the browser refused to play. */
export class SpeechError extends Error {
  constructor(readonly reason: 'not-configured' | 'blocked' | 'failed') {
    super(`speech ${reason}`);
  }
}

export interface ISpeechEngine {
  id: IEngineId;
  /** Prose sentences are joined into one request up to this length. */
  maxChars: number;
  /** Called in a click, so later playback passes the autoplay policy. */
  unlock(): void;
  /** Resolves when playback has ended, or at once when `signal` aborts. */
  speak(text: string, signal: AbortSignal, options?: { keep?: boolean }): Promise<void>;
  /** Starts loading what `speak` will be asked next. */
  prefetch?(text: string, options?: { keep?: boolean }): void;
  stop(): void;
}

export interface ISpeechQueueState {
  /** Something is queued, loading or playing: the agent is still responding. */
  active: boolean;
  /** The engine in use now. */
  engine: IEngineId;
  /** The browser refused to play without a click: "Tap to hear the reply". */
  blocked: boolean;
}

export interface ISpeechQueueOptions {
  choice: IEngineChoice;
  engines: Record<IEngineId, ISpeechEngine>;
  /** The admin chose ElevenLabs but the server has no key, so the browser voice speaks. */
  onNotConfigured?: () => void;
}

interface IChunk {
  text: string;
  /** Pointer audio is kept: the same few phrases come back in every reply. */
  keep: boolean;
}

/**
 * Speaks script segments in order (voice design §6.6). Each segment id is taken once per message,
 * so the whole script can be offered again on every streamed update.
 */
export class SpeechQueue {
  private snapshot: ISpeechQueueState;
  private readonly listeners = new Set<() => void>();
  private readonly seen = new Set<string>();
  private pending: ISpeechSegment[] = [];
  private controller = new AbortController();
  private running = false;
  private choice: IEngineChoice;
  /** ElevenLabs answered 503: the browser voice speaks for the rest of the session. */
  private notConfigured = false;

  constructor(private readonly options: ISpeechQueueOptions) {
    this.choice = options.choice;
    this.snapshot = { active: false, engine: this.engineId(), blocked: false };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  setChoice(choice: IEngineChoice) {
    this.choice = choice;
    this.update({ engine: this.engineId() });
  }

  /** In the click that turns voice on (or "Tap to hear"): both engines may be needed. */
  unlock() {
    this.options.engines.elevenlabs.unlock();
    this.options.engines.browser.unlock();
  }

  /** Queues the segments of `messageId` not taken before. */
  enqueue(messageId: string, segments: ISpeechSegment[]) {
    let added = false;
    for (const segment of segments) {
      const key = `${messageId}/${segment.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.pending.push(segment);
      added = true;
    }
    if (!added) return;
    // active at once, also while a stopped pump is still winding down (it pumps again after)
    this.update({ active: true });
    void this.pump();
  }

  /** Marks segments as taken without speaking them: a reply that was on screen before voice. */
  skip(messageId: string, segments: ISpeechSegment[]) {
    segments.forEach((s) => this.seen.add(`${messageId}/${s.id}`));
  }

  /** Stop: nothing more is said, and what is loading is dropped. */
  stop() {
    this.pending = [];
    this.controller.abort();
    this.controller = new AbortController();
    this.options.engines.elevenlabs.stop();
    this.options.engines.browser.stop();
    this.update({ active: false, blocked: false });
  }

  /** "Tap to hear the reply": the tap is the gesture the browser wanted. */
  resumeBlocked() {
    this.unlock();
    this.update({ blocked: false });
    void this.pump();
  }

  dispose() {
    this.stop();
    this.listeners.clear();
  }

  private update(patch: Partial<ISpeechQueueState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private engineId(): IEngineId {
    if (this.choice === 'browser' || this.notConfigured) return 'browser';
    return 'elevenlabs';
  }

  private engine() {
    return this.options.engines[this.engineId()];
  }

  /** The next request: one pointer, or prose sentences joined up to the engine's length. */
  private take(): IChunk | undefined {
    const first = this.pending.shift();
    if (!first) return undefined;
    if (first.kind === 'pointer') return { text: first.text, keep: true };
    const max = this.engine().maxChars;
    let text = first.text;
    while (
      this.pending[0]?.kind === 'prose' &&
      text.length + 1 + this.pending[0].text.length <= max
    ) {
      text = `${text} ${this.pending.shift()!.text}`;
    }
    return { text, keep: false };
  }

  private async pump() {
    if (this.running || this.snapshot.blocked) return;
    this.running = true;
    this.update({ active: true });
    const { signal } = this.controller;
    let current = this.take();
    while (current) {
      const next = this.take();
      if (next) this.engine().prefetch?.(next.text, { keep: next.keep });
      const played = await this.play(current, signal);
      // after Stop, what is queued belongs to the next reply: leave it for the next pump
      if (signal.aborted) break;
      if (!played) {
        // blocked: both wait for the tap
        this.pending.unshift(...[current, next].filter((c): c is IChunk => !!c).map(toSegment));
        break;
      }
      current = next ?? this.take();
    }
    this.running = false;
    if (this.pending.length && !this.snapshot.blocked) return void this.pump();
    this.update({ active: this.pending.length > 0 });
  }

  /** Plays a chunk with the current engine and its fallbacks; false when the browser blocked it. */
  private async play(chunk: IChunk, signal: AbortSignal): Promise<boolean> {
    const engine = this.engine();
    const reason = await speakWith(engine, chunk, signal);
    if (!reason || signal.aborted) return true;
    if (reason === 'blocked') return this.block();
    if (engine.id === 'browser') return true; // nothing left to try: the text is on screen
    if (reason === 'not-configured' && !this.notConfigured) {
      this.notConfigured = true;
      this.update({ engine: 'browser' });
      if (this.choice === 'elevenlabs') this.options.onNotConfigured?.();
    }
    // this chunk in the browser voice; a failure there is skipped
    const again = await speakWith(this.options.engines.browser, chunk, signal);
    return again === 'blocked' && !signal.aborted ? this.block() : true;
  }

  private block() {
    this.update({ blocked: true });
    return false;
  }
}

/** Why the engine could not say it, or undefined when it did. */
const speakWith = (engine: ISpeechEngine, chunk: IChunk, signal: AbortSignal) =>
  engine.speak(chunk.text, signal, { keep: chunk.keep }).then(
    () => undefined,
    (error: unknown) => (error instanceof SpeechError ? error.reason : 'failed')
  );

const toSegment = (chunk: IChunk, i: number): ISpeechSegment => ({
  id: `retry-${i}`,
  kind: chunk.keep ? 'pointer' : 'prose',
  text: chunk.text,
});
