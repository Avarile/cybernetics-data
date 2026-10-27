/** No speech for this long sends what was said (voice design §5.3). */
export const SILENCE_MS = 3000;
/** Waits before restarting after a `network` error; one more failure turns listening off. */
const NETWORK_BACKOFF_MS = [1000, 2000, 4000];

export type IListenerStatus = 'off' | 'listening' | 'paused' | 'failed';
/** Why listening cannot go on: the mic is blocked or missing, or recognition keeps failing. */
export type IListenerError = 'blocked' | 'no-microphone' | 'unavailable';

export interface IListenerState {
  status: IListenerStatus;
  /** The sentences heard so far, sent together after the silence. */
  draft: string;
  /** What is being said now; replaced on every result. */
  interim: string;
  /** When the silence countdown ends, while there is something to send. */
  deadline?: number;
  error?: IListenerError;
}

export interface IVoiceListenerOptions {
  lang: string;
  /** The whole input after the silence (or Send now). Listening pauses until `resume()`. */
  onSend: (text: string) => void;
  /** Listening stopped for good: the mic is blocked or missing. */
  onFatal?: (error: IListenerError) => void;
  createRecognition?: () => ISpeechRecognition | undefined;
  silenceMs?: number;
}

export const speechRecognitionSupported = () =>
  typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

const createBrowserRecognition = () => {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  return Recognition ? new Recognition() : undefined;
};

const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');

/**
 * Continuous speech recognition for voice mode (voice design §5): each final result is added to
 * the draft, and SILENCE_MS without any result sends the draft. Recognition restarts by itself
 * when the browser ends it, and stays off while paused.
 */
export class VoiceListener {
  private snapshot: IListenerState = { status: 'off', draft: '', interim: '' };
  private readonly listeners = new Set<() => void>();
  private recognition?: ISpeechRecognition;
  private running = false;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private networkFailures = 0;
  private lang: string;
  private readonly silenceMs: number;

  constructor(private readonly options: IVoiceListenerOptions) {
    this.lang = options.lang;
    this.silenceMs = options.silenceMs ?? SILENCE_MS;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Starts listening; `prefix` (typed text) becomes the start of the draft. */
  start(prefix = '') {
    this.update({ status: 'listening', draft: prefix.trim(), interim: '', error: undefined });
    this.networkFailures = 0;
    this.listen();
  }

  /** Stops listening and keeps the draft (the agent is talking, or the page is hidden). */
  pause() {
    if (this.snapshot.status !== 'listening') return;
    this.halt();
    const { draft, interim } = this.snapshot;
    this.update({
      status: 'paused',
      draft: join(draft, interim),
      interim: '',
      deadline: undefined,
    });
  }

  /** Listens again after a pause; a kept draft starts a new countdown. */
  resume() {
    if (this.snapshot.status !== 'paused' && this.snapshot.status !== 'failed') return;
    this.networkFailures = 0;
    this.update({ status: 'listening', error: undefined });
    if (this.snapshot.draft) this.countdown();
    this.listen();
  }

  /** Voice is off: returns what was heard but not sent, for the textarea. */
  stop(): string {
    this.halt();
    const text = join(this.snapshot.draft, this.snapshot.interim);
    this.update({ status: 'off', draft: '', interim: '', deadline: undefined, error: undefined });
    return text;
  }

  /** Drops the draft; the sentence being heard is dropped too. */
  clear() {
    this.clearSilence();
    this.update({ draft: '', interim: '', deadline: undefined });
    // aborting discards the pending result; `end` then restarts recognition
    if (this.running) this.recognition?.abort();
  }

  /** Sends the draft now instead of waiting for the silence. */
  sendNow() {
    const text = join(this.snapshot.draft, this.snapshot.interim);
    if (!text) return;
    this.halt();
    this.update({ status: 'paused', draft: '', interim: '', deadline: undefined });
    this.options.onSend(text);
  }

  dispose() {
    this.halt();
    this.listeners.clear();
  }

  private update(patch: Partial<IListenerState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private listen() {
    if (this.running) return;
    const recognition = this.recognition ?? this.create();
    if (!recognition) {
      this.fail('unavailable');
      return;
    }
    recognition.lang = this.lang;
    try {
      recognition.start();
      this.running = true;
    } catch {
      // already started: the running session goes on
      this.running = true;
    }
  }

  /** Ends recognition and every timer, dropping the result still being heard. */
  private halt() {
    this.clearSilence();
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.running) {
      this.running = false;
      this.recognition?.abort();
    }
  }

  private create() {
    const recognition = (this.options.createRecognition ?? createBrowserRecognition)();
    if (!recognition) return undefined;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => this.onResult(event);
    recognition.onerror = (event) => this.onError(event.error);
    recognition.onend = () => this.onEnd();
    this.recognition = recognition;
    return recognition;
  }

  private onResult(event: ISpeechRecognitionEvent) {
    if (this.snapshot.status !== 'listening') return;
    this.networkFailures = 0;
    let finals = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) finals = join(finals, transcript);
      else interim = join(interim, transcript);
    }
    this.update({ draft: join(this.snapshot.draft, finals), interim });
    this.countdown();
  }

  /** Every result restarts the countdown; when it ends, everything heard is sent. */
  private countdown() {
    this.clearSilence();
    this.update({ deadline: Date.now() + this.silenceMs });
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = undefined;
      this.sendNow();
      if (this.snapshot.deadline) this.update({ deadline: undefined });
    }, this.silenceMs);
  }

  private clearSilence() {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
  }

  private onError(error: string) {
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        return this.fatal('blocked');
      case 'audio-capture':
        return this.fatal('no-microphone');
      case 'language-not-supported':
        if (this.lang === 'en-US') return this.fail('unavailable');
        this.lang = 'en-US';
        return;
      case 'network':
        this.networkFailures++;
        return;
      default:
        // no-speech, aborted: `end` follows and restarts
        return;
    }
  }

  private onEnd() {
    if (!this.running) return;
    this.running = false;
    if (this.snapshot.status !== 'listening') return;
    if (!this.networkFailures) return this.listen();
    if (this.networkFailures > NETWORK_BACKOFF_MS.length) return this.fail('unavailable');
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        if (this.snapshot.status === 'listening') this.listen();
      },
      NETWORK_BACKOFF_MS[this.networkFailures - 1]
    );
  }

  /** Recognition does not work right now; Retry (resume) tries again. */
  private fail(error: IListenerError) {
    this.halt();
    this.update({ status: 'failed', error, interim: '', deadline: undefined });
  }

  private fatal(error: IListenerError) {
    this.halt();
    this.update({ status: 'off', error, interim: '', deadline: undefined });
    this.options.onFatal?.(error);
  }
}
