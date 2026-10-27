/**
 * POST /api/agent/tts (voice design §7.1): admin only, validated, 503 without an ElevenLabs key,
 * and the audio streamed through. ElevenLabs itself is stubbed; no request leaves the process.
 */
import type { INestApplication } from '@nestjs/common';
import { AGENT_TTS, AGENT_TTS_MAX_CHARS, axios } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const elevenLabsUrl = 'https://api.elevenlabs.io/';

describe('Agent voice (e2e)', () => {
  let app: INestApplication;
  let member: AxiosInstance;
  const savedKey = process.env.ELEVENLABS_API_KEY;
  const realFetch = globalThis.fetch;
  /** The requests that would have gone to ElevenLabs. */
  const upstream: { url: string; body: unknown }[] = [];

  /** Answers ElevenLabs calls with `reply`; every other fetch goes through. */
  const stubElevenLabs = (reply: () => Response) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(elevenLabsUrl)) return realFetch(input, init);
      upstream.push({ url, body: JSON.parse(String(init?.body)) });
      return reply();
    });

  beforeAll(async () => {
    app = (await initApp()).app;
    member = await createNewUserAxios({
      email: 'agent-voice-member@example.com',
      password: '12345678',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    upstream.length = 0;
    if (savedKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = savedKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a non-admin', async () => {
    expect((await getError(() => member.post(AGENT_TTS, { text: 'Hello' })))?.status).toBe(403);
  });

  it('refuses empty, blank, too long and unknown input', async () => {
    for (const body of [
      {},
      { text: '' },
      { text: '   ' },
      { text: 'x'.repeat(AGENT_TTS_MAX_CHARS + 1) },
      { text: 'Hello', voice: 'other' },
    ]) {
      expect((await getError(() => axios.post(AGENT_TTS, body)))?.status).toBe(400);
    }
  });

  it('answers 503 when ElevenLabs is not configured', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const error = await getError(() => axios.post(AGENT_TTS, { text: 'Hello' }));
    expect(error?.status).toBe(503);
  });

  it('streams the audio, with the trimmed text sent upstream', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00, 0x01]);
    stubElevenLabs(
      () => new Response(audio, { status: 200, headers: [['Content-Type', 'audio/mpeg']] })
    );

    const res = await axios.post<ArrayBuffer>(
      AGENT_TTS,
      { text: '  Please take a look at this table.  ' },
      { responseType: 'arraybuffer' }
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(new Uint8Array(res.data)).toEqual(audio);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].body).toMatchObject({ text: 'Please take a look at this table.' });
  });

  it('answers 502 when ElevenLabs fails', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    stubElevenLabs(() => new Response('{"detail":"invalid key"}', { status: 401 }));
    const error = await getError(() => axios.post(AGENT_TTS, { text: 'Hello' }));
    expect(error?.status).toBe(502);
  });
});
