import type { ISpeechEngine } from '../speech-queue';
import { SpeechError } from '../speech-queue';
import { splitLong } from '../speech-script';

/** Chrome's Google voices stop after about 15 s of speech; 180 characters stays well under. */
export const BROWSER_MAX_CHARS = 180;
const VOICES_TIMEOUT_MS = 2000;

export const browserSpeechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

const langOf = (voice: { lang: string }) => voice.lang.toLowerCase().replace('_', '-');
const baseLang = (lang: string) => lang.toLowerCase().split(/[-_]/)[0];
/** Chrome's online voices: "Google US English", "Google 普通话（中国大陆）", … */
export const isGoogleVoice = (voice: SpeechSynthesisVoice) => voice.name.startsWith('Google');

/**
 * The voice for `lang` (voice design §6.7): the saved one if this machine has it, else a Google
 * voice for the language, else the system's voice for it, else the browser's default.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  voiceURI?: string
): SpeechSynthesisVoice | undefined {
  const saved = voiceURI && voices.find((v) => v.voiceURI === voiceURI);
  if (saved) return saved;
  const exact = (v: SpeechSynthesisVoice) => langOf(v) === lang.toLowerCase();
  const same = (v: SpeechSynthesisVoice) => baseLang(v.lang) === baseLang(lang);
  return (
    voices.find((v) => exact(v) && isGoogleVoice(v)) ??
    voices.find((v) => same(v) && isGoogleVoice(v)) ??
    voices.find((v) => exact(v) && v.default) ??
    voices.find(exact) ??
    voices.find(same) ??
    voices.find((v) => v.default) ??
    voices[0]
  );
}

export interface IBrowserVoiceDeps {
  synth?: SpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
}

/**
 * Replies spoken by the browser (`speechSynthesis`): Chrome's Google voices, Edge's online voices,
 * the system's voices (voice design §6.7). One utterance at a time, so Stop and `active` are exact.
 */
export class BrowserVoiceEngine implements ISpeechEngine {
  readonly id = 'browser' as const;
  readonly maxChars = BROWSER_MAX_CHARS;
  /** Chrome may garbage-collect an utterance mid-speech and never fire `end`: keep a reference. */
  private current?: SpeechSynthesisUtterance;
  private readonly synth?: SpeechSynthesis;
  private readonly createUtterance: NonNullable<IBrowserVoiceDeps['createUtterance']>;

  constructor(
    private readonly settings: () => { lang: string; voiceURI?: string },
    deps: IBrowserVoiceDeps = {}
  ) {
    this.synth = deps.synth ?? (browserSpeechSupported() ? window.speechSynthesis : undefined);
    this.createUtterance = deps.createUtterance ?? ((text) => new SpeechSynthesisUtterance(text));
  }

  /** The voices, once the browser has loaded them (Chrome lists none at first). */
  async voices(): Promise<SpeechSynthesisVoice[]> {
    const synth = this.synth;
    if (!synth) return [];
    const now = synth.getVoices();
    if (now.length) return now;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, VOICES_TIMEOUT_MS);
      synth.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
    return synth.getVoices();
  }

  unlock() {
    if (!this.synth) return;
    // clears a queue an earlier page left stuck, and speaks inside the click
    this.synth.cancel();
    this.synth.speak(this.createUtterance(''));
  }

  async speak(text: string, signal: AbortSignal) {
    if (!this.synth) throw new SpeechError('failed');
    const { lang, voiceURI } = this.settings();
    const voices = await this.voices();
    const voice = pickVoice(voices, lang, voiceURI);
    for (const piece of splitLong(text, this.maxChars)) {
      if (signal.aborted) return;
      try {
        await this.utter(piece, voice, lang, signal);
      } catch (error) {
        // an online voice that fails (offline) gets one retry in a voice on this machine
        const offline =
          error instanceof SpeechError && error.reason === 'failed' && voice && !voice.localService
            ? pickVoice(
                voices.filter((v) => v.localService),
                lang
              )
            : undefined;
        if (!offline) throw error;
        await this.utter(piece, offline, lang, signal);
      }
    }
  }

  stop() {
    this.current = undefined;
    this.synth?.cancel();
  }

  private utter(
    text: string,
    voice: SpeechSynthesisVoice | undefined,
    lang: string,
    signal: AbortSignal
  ) {
    const synth = this.synth!;
    return new Promise<void>((resolve, reject) => {
      const utterance = this.createUtterance(text);
      utterance.lang = voice?.lang ?? lang;
      if (voice) utterance.voice = voice;
      const done = (error?: SpeechError) => {
        signal.removeEventListener('abort', onAbort);
        if (this.current === utterance) this.current = undefined;
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => done();
      signal.addEventListener('abort', onAbort);
      utterance.onend = () => done();
      utterance.onerror = (event) => {
        // interrupted and canceled come from our own cancel()
        if (event.error === 'interrupted' || event.error === 'canceled') return done();
        done(new SpeechError(event.error === 'not-allowed' ? 'blocked' : 'failed'));
      };
      this.current = utterance;
      synth.speak(utterance);
    });
  }
}
