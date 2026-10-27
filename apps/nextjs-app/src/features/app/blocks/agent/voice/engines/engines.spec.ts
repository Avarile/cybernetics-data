/* eslint-disable sonarjs/no-duplicate-string */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechError } from '../speech-queue';
import { BROWSER_MAX_CHARS, BrowserVoiceEngine, pickVoice } from './browser-engine';
import { ElevenLabsEngine } from './elevenlabs-engine';

const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
  ({
    name,
    lang,
    voiceURI: name,
    default: false,
    localService: true,
    ...extra,
  }) as SpeechSynthesisVoice;

const david = voice('Microsoft David', 'en-US', { default: true });
const googleUs = voice('Google US English', 'en-US', { localService: false });
const googleZh = voice('Google 普通话（中国大陆）', 'zh-CN', { localService: false });
const tingTing = voice('Ting-Ting', 'zh-CN');
const voices = [david, googleUs, googleZh, tingTing];

const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (e: unknown) => (e instanceof SpeechError ? e.reason : String(e))
  );

describe('pickVoice', () => {
  it('prefers a Google voice for the language, then the system voice, then the default', () => {
    expect(pickVoice(voices, 'en-US')).toBe(googleUs);
    expect(pickVoice(voices, 'en-GB')).toBe(googleUs);
    expect(pickVoice(voices, 'zh-CN')).toBe(googleZh);
    expect(pickVoice([david, tingTing], 'zh-CN')).toBe(tingTing);
    expect(pickVoice(voices, 'fr-FR')).toBe(david);
    expect(pickVoice([], 'en-US')).toBeUndefined();
  });

  it('uses the saved voice when this machine has it', () => {
    expect(pickVoice(voices, 'en-US', 'Microsoft David')).toBe(david);
    expect(pickVoice(voices, 'en-US', 'gone')).toBe(googleUs);
  });
});

describe('browser voice engine', () => {
  type IUtterance = {
    text: string;
    lang: string;
    voice?: SpeechSynthesisVoice;
    onend: (() => void) | null;
    onerror: ((e: { error: string }) => void) | null;
  };
  let list: SpeechSynthesisVoice[];
  let spoken: IUtterance[];
  let react: (u: IUtterance) => void;
  let onVoices: (() => void) | undefined;
  const synth = {
    getVoices: () => list,
    speak: vi.fn((u: IUtterance) => {
      spoken.push(u);
      setTimeout(() => react(u));
    }),
    cancel: vi.fn(),
    addEventListener: (_: string, cb: () => void) => {
      onVoices = cb;
    },
  };
  const engine = (lang = 'en-US', voiceURI?: string) =>
    new BrowserVoiceEngine(() => ({ lang, voiceURI }), {
      synth: synth as unknown as SpeechSynthesis,
      createUtterance: (text) =>
        ({ text, lang: '', onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
    });
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    list = voices;
    spoken = [];
    react = (u) => u.onend?.();
    onVoices = undefined;
  });

  it('speaks in the picked voice', async () => {
    await engine('en-US').speak('Hello there.', signal());
    expect(spoken.map((u) => [u.text, u.voice?.name, u.lang])).toEqual([
      ['Hello there.', 'Google US English', 'en-US'],
    ]);
  });

  it('waits for Chrome to load its voices', async () => {
    list = [];
    const speaking = engine('zh-CN').speak('你好。', signal());
    await vi.waitFor(() => expect(onVoices).toBeDefined());
    list = voices;
    onVoices!();
    await speaking;
    expect(spoken[0].voice).toBe(googleZh);
  });

  it(`speaks long text in pieces of at most ${BROWSER_MAX_CHARS} characters`, async () => {
    const text = Array.from({ length: 12 }, (_, i) => `part ${i} of a long answer`).join(', ');
    await engine().speak(text, signal());
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.every((u) => u.text.length <= BROWSER_MAX_CHARS)).toBe(true);
  });

  it('treats interrupted and canceled as stopped, not failed', async () => {
    react = (u) => u.onerror?.({ error: 'interrupted' });
    await expect(engine().speak('Stopped.', signal())).resolves.toBeUndefined();
  });

  it('retries an online voice that fails in a voice on this machine', async () => {
    react = (u) => (u.voice?.localService ? u.onend?.() : u.onerror?.({ error: 'network' }));
    await engine().speak('Offline now.', signal());
    expect(spoken.map((u) => u.voice?.name)).toEqual(['Google US English', 'Microsoft David']);
  });

  it('reports a refused speak as blocked and a missing API as failed', async () => {
    react = (u) => u.onerror?.({ error: 'not-allowed' });
    expect(await reasonOf(engine().speak('Hi.', signal()))).toBe('blocked');
    const none = new BrowserVoiceEngine(() => ({ lang: 'en-US' }), {
      synth: undefined,
      createUtterance: vi.fn(),
    });
    // no synth in the test DOM either
    expect(await reasonOf(none.speak('Hi.', signal()))).toBe('failed');
  });

  it('resolves at once when stopped', async () => {
    react = () => undefined;
    const controller = new AbortController();
    const speaking = engine().speak('Never ends.', controller.signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    controller.abort();
    await expect(speaking).resolves.toBeUndefined();
  });
});

describe('ElevenLabs engine', () => {
  let fetchAudio: ReturnType<typeof vi.fn>;
  let audio: {
    src: string;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
    onerror: (() => void) | null;
  };
  const ok = () => new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });
  const engine = () =>
    new ElevenLabsEngine({
      fetchAudio: fetchAudio as never,
      createAudio: () => audio as unknown as HTMLAudioElement,
    });
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    fetchAudio = vi.fn(async () => ok());
    audio = {
      src: '',
      play: vi.fn(async () => {
        setTimeout(() => audio.onended?.());
      }),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      onended: null,
      onerror: null,
    };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the audio, plays it and frees the URL', async () => {
    await engine().speak('Hello.', signal());
    expect(fetchAudio).toHaveBeenCalledWith('Hello.', expect.any(AbortSignal));
    expect(audio.src).toBe('blob:audio');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio');
  });

  it('keeps pointer audio, and loads a prefetched text once', async () => {
    const e = engine();
    await e.speak('Please take a look at this table.', signal(), { keep: true });
    await e.speak('Please take a look at this table.', signal(), { keep: true });
    e.prefetch('Next sentence.');
    await e.speak('Next sentence.', signal());
    await e.speak('Next sentence.', signal());
    expect(fetchAudio.mock.calls.map((c) => c[0])).toEqual([
      'Please take a look at this table.',
      'Next sentence.',
      'Next sentence.',
    ]);
  });

  it('reports 503 as not configured and other errors as failed', async () => {
    fetchAudio.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await reasonOf(engine().speak('Hi.', signal()))).toBe('not-configured');
    fetchAudio.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    expect(await reasonOf(engine().speak('Hi.', signal()))).toBe('failed');
  });

  it('reports a play the browser refused as blocked', async () => {
    audio.play.mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'));
    expect(await reasonOf(engine().speak('Hi.', signal()))).toBe('blocked');
  });

  it('stop aborts the request and pauses the audio', async () => {
    fetchAudio.mockImplementationOnce(
      (_text: string, s: AbortSignal) =>
        new Promise((_, reject) => s.addEventListener('abort', () => reject(new Error('aborted'))))
    );
    const e = engine();
    const speaking = reasonOf(e.speak('Slow.', signal()));
    e.stop();
    expect(await speaking).toContain('aborted');
    expect(audio.pause).not.toHaveBeenCalled(); // no audio element yet
    e.unlock();
    e.stop();
    expect(audio.pause).toHaveBeenCalled();
  });
});
