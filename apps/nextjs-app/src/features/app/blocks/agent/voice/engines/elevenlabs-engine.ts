import { agentTts } from '@teable/openapi';
import type { ISpeechEngine } from '../speech-queue';
import { SpeechError } from '../speech-queue';

/** A WAV with no samples: played in the click so the element may play later (autoplay policy). */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export interface IElevenLabsDeps {
  fetchAudio?: (text: string, signal: AbortSignal) => Promise<Response>;
  createAudio?: () => HTMLAudioElement;
}

/**
 * Replies spoken by ElevenLabs through POST /api/agent/tts (voice design §6.6, §7.1): one audio
 * element, the next request loaded while one plays, pointer audio kept for the session.
 */
export class ElevenLabsEngine implements ISpeechEngine {
  readonly id = 'elevenlabs' as const;
  readonly maxChars = 300;
  private audio?: HTMLAudioElement;
  private controller = new AbortController();
  private readonly loads = new Map<string, Promise<Blob>>();
  private readonly kept = new Set<string>();
  private readonly fetchAudio: NonNullable<IElevenLabsDeps['fetchAudio']>;
  private readonly createAudio: NonNullable<IElevenLabsDeps['createAudio']>;

  constructor(deps: IElevenLabsDeps = {}) {
    this.fetchAudio = deps.fetchAudio ?? agentTts;
    this.createAudio = deps.createAudio ?? (() => new Audio());
  }

  unlock() {
    const audio = this.element();
    audio.src = SILENCE;
    void audio.play()?.catch(() => undefined);
  }

  prefetch(text: string, options?: { keep?: boolean }) {
    void this.load(text, options?.keep).catch(() => undefined);
  }

  async speak(text: string, signal: AbortSignal, options?: { keep?: boolean }) {
    let blob: Blob;
    try {
      blob = await this.load(text, options?.keep);
    } finally {
      if (!this.kept.has(text)) this.loads.delete(text);
    }
    if (signal.aborted) return;
    await this.playBlob(blob, signal);
  }

  stop() {
    this.controller.abort();
    this.controller = new AbortController();
    for (const text of this.loads.keys()) if (!this.kept.has(text)) this.loads.delete(text);
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
    }
  }

  private element() {
    this.audio ??= this.createAudio();
    return this.audio;
  }

  private load(text: string, keep = false): Promise<Blob> {
    const loaded = this.loads.get(text);
    if (loaded) return loaded;
    const loading = this.request(text);
    this.loads.set(text, loading);
    if (keep) this.kept.add(text);
    // a failed load is not kept: the next time asks again
    loading.catch(() => {
      this.loads.delete(text);
      this.kept.delete(text);
    });
    return loading;
  }

  private async request(text: string): Promise<Blob> {
    const res = await this.fetchAudio(text, this.controller.signal);
    if (res.status === 503) throw new SpeechError('not-configured');
    if (!res.ok) throw new SpeechError('failed');
    const blob = await res.blob();
    if (!blob.size) throw new SpeechError('failed');
    return blob;
  }

  private playBlob(blob: Blob, signal: AbortSignal) {
    const audio = this.element();
    const url = URL.createObjectURL(blob);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: SpeechError) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        signal.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => done();
      signal.addEventListener('abort', onAbort);
      audio.onended = () => done();
      audio.onerror = () => done(new SpeechError('failed'));
      audio.src = url;
      audio.play().catch((error: unknown) => {
        if (signal.aborted) return done();
        const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
        done(new SpeechError(blocked ? 'blocked' : 'failed'));
      });
    });
  }
}
