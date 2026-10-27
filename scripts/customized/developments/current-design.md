# Agent voice conversation: talk to the agent hands-free

Status: **designed and approved 2026-10-27 (decisions in §12 confirmed), not built.** Branch:
`feat/agentic-database`.
The previous content of this file (the follow-up design, P0–P5 done) is in git history:
`git show 629680a1:scripts/customized/developments/current-design.md`.

Every "today" statement was read from the working tree on 2026-10-27 (HEAD `fd8e3ff3`). Paths are
relative to `apps/nextjs-app/src/features/app/blocks/agent/` unless they start with `apps/` or
`packages/`.

---

## 1. Summary

A **Voice** switch in the agent composer turns the chat into a spoken conversation. While it is on:

- the admin speaks; each sentence is transcribed onto the screen, and the whole input is sent once
  they have been silent for 3 seconds (Feature 1);
- the agent's reply is read aloud. Tables, code and forms are not read out: the agent says
  "Please take a look at this table / code / form" in their place (Feature 2);
- the reply is spoken by ElevenLabs or by the browser's own voice, such as Chrome's "Google US
  English". The admin picks the engine and the voice (§6.7);
- the switch cannot be turned off while the agent is responding.

| Part | What changes |
|---|---|
| A. Switch | Voice switch, its lock while the agent responds, on/off behaviour (§4) |
| B. Listening | Continuous recognition, sentence transcripts, 3-second silence send, mic paused while the agent talks (§5) |
| C. Speaking | Reply turned into a speech script, with pointers for tables, code and forms; queued playback through either engine: ElevenLabs or the browser voice (§6) |
| D. Server | `POST /api/agent/tts` for the admin-only agent; optional voice hint in the system prompt (§7) |
| E. UI | Voice composer, status line, countdown, voice settings (§8) |

The state machine is in §9, files and phases in §10, tests in §11, decisions in §12 and risks in §13.

---

## 2. Current state

### 2.1 Voice input

- `components/AgentComposer.tsx:116` renders the shared `SpeechInput`
  (`apps/nextjs-app/src/components/ai-elements/speech-input.tsx`).
- It uses the browser's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) with
  `continuous = true` and `interimResults = true`. Only final results are used. Each one is
  appended to the textarea. Nothing is sent automatically.
- The language is always `en-US`, because the composer passes no `lang`. The button is disabled
  while a reply streams.
- In Firefox the button is disabled. The component's MediaRecorder fallback needs an
  `onAudioRecorded` transcriber, which the composer doesn't pass, and the server has no
  speech-to-text endpoint.

### 2.2 Voice output

- Nothing on the agent page speaks.
- `POST /api/:baseId/ai/tts` (`apps/nestjs-backend/src/features/ai/ai.controller.ts:37`,
  permission `base|read`) streams `audio/mpeg` from ElevenLabs through `TtsService`
  (`apps/nestjs-backend/src/features/ai/service/tts.service.ts`).
  - Configuration is `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID`
    (default `eleven_turbo_v2`, English only). It returns 503 when the key is unset.
  - The key is set in `apps/nextjs-app/.env.development.local`.
- `AiModule` provides `TtsService` but exports only `AiService`. `AgentModule` already imports
  `AiModule`.
- The only caller of that endpoint, `VoiceParser.tsx` in the old table chat panel, was deleted in
  `960c33bb`. Its `stripForTts` markdown cleanup is reused in §6.3.
- The browser's own text-to-speech (`window.speechSynthesis`) isn't used anywhere in
  `apps/nextjs-app/src`.
- `apps/nextjs-app/src/components/ai-elements/voice-selector.tsx` (483 lines) is unused. It is a
  searchable picker dialog with name, gender, accent and preview slots, but no data source. It is
  reused for the voice picker (§8).

### 2.3 Chat and replies

- `useAgentChat.ts` wraps the AI SDK `AbstractChat` (`ai` 6.0.169). Its status is `submitted`,
  `streaming`, `ready` or `error`. `AgentChatView.tsx:42` sets `busy = submitted || streaming`.
  Stop calls `chat.stop()` and then `cancelAgentRun`.
- A reply is a list of parts. Text parts are rendered by `MessageResponse` (Streamdown: GFM
  tables, Shiki code, mermaid, math). Text parts carry `state: 'streaming' | 'done'`.
  - Reasoning parts are collapsible.
  - Tool parts render as `AgentToolStep` (collapsible JSON input and output). When the state is
    `approval-requested`, an `ApprovalCard` with Approve and Deny buttons is shown as well.
- **Approvals**
  - While an approval waits, the run is paused as `awaiting_approval` and the client status
    returns to `ready`.
  - Answers are sent automatically (`useAgentChat.ts:115`, `sendAutomaticallyWhen`), and the
    reply continues in the same assistant message.
  - A **new message while an approval waits denies it** ("The admin sent a new message instead
    of answering", `apps/nestjs-backend/src/features/agent/application/chat/run-turn.usecase.ts:77`).
- `AgentChatView` is shared by the `/agent` page (`AgentPage.tsx`) and the table side panel
  (`AgentPanel.tsx:166`). `AgentThreadChat` remounts when the thread changes or a new chat starts.
- `streamdown` exports `parseMarkdownIntoBlocks`, the same splitter the renderer uses. Tested on
  2026-10-27:
  - Prose, a table and a code block come back as separate blocks.
  - A half-streamed table (`"| Name | To"`) comes back as its own last block.

---

## 3. Goals and non-goals

Goals:

- **G1.** One switch turns voice conversation on and off. It is the same switch on the page and in
  the side panel.
- **G2.** Each spoken sentence is transcribed and shown. After 3 seconds without speech, the whole
  input is sent.
- **G3.** The reply is spoken. Tables, code and forms are not read out; the agent asks the admin to
  look at them instead.
- **G4.** The switch cannot be turned off while the agent is responding.
- **G5.** Replies can be spoken by ElevenLabs or by the browser's own voice, such as Chrome's Google
  voices. The admin chooses the engine and the browser voice.

Non-goals for v1:

- Interrupting the agent by voice (barge-in).
- Answering approvals by voice.
- Firefox support, which would need server-side speech-to-text.
- A wake word.
- Choosing an ElevenLabs voice in the UI. That stays `ELEVENLABS_VOICE_ID` (§7.2).
- Rate and pitch controls.
- Voice on the admin pages.
- Keeping the switch on across page reloads.

---

## 4. Part A: the switch

### 4.1 Placement and state

- **Placement.** The switch sits in a slim footer row under the composer, labelled "Voice" with
  the `AudioLines` icon. It uses the shadcn `Switch` from `@teable/ui-lib`. `AgentComposer` is
  shared, so the page and the side panel both get it.
- **State.** `voice/voice-store.ts` is a zustand store holding `{ enabled, setEnabled }`. It
  follows the pattern of `useChatPanelStore`.
  - It is not persisted. It survives thread switches and `/clear` (which remount
    `AgentThreadChat`).
  - It resets on reload, because microphone start and audio playback both need a fresh click.

### 4.2 Rules

| Situation | Switch |
|---|---|
| Browser has no `SpeechRecognition` (Firefox) | Disabled. Tooltip: "Voice needs Chrome, Edge or Safari" |
| Chat disabled (agent off or not healthy: the composer's `disabled`) | Disabled |
| Off → on | Allowed whenever the switch isn't disabled for the reasons above, including while a reply streams (D3) |
| On → off while **responding** | **Disabled.** Tooltip: "Voice can be turned off when the agent has finished. Use Stop to end the reply now." |
| On → off otherwise (listening, countdown, waiting for an approval, paused) | Allowed |

- **Responding** means from the moment a turn is sent until the stream has ended **and** every
  queued speech segment has played: `busy || speaker.active`.
- Waiting for an approval is not responding. The run is paused for the admin, so the switch works
  then.
- **Stop is the way out.** It ends the run (as today) and the speech, so the agent is no longer
  responding and the switch unlocks.

### 4.3 Turning on

These steps run inside the click handler, so they count as a user gesture:

1. `speaker.unlock()`: play a silent clip on the shared `HTMLAudioElement`, and call
   `speechSynthesis.speak()` with an empty utterance for the browser fallback. Later `play()`
   calls then pass the autoplay policy.
2. `listener.start()`. The first time, the browser asks for microphone permission.
3. Any text already typed in the textarea becomes the start of the voice draft.
4. If a reply is streaming, listening waits until it ends. That reply is spoken from its beginning
   (D3).

### 4.4 Turning off

- Recognition stops and the countdown is cancelled.
- The current draft moves back into the textarea, so nothing is lost.
- Nothing is playing at this point, because the switch is locked while speech plays.

---

## 5. Part B: listening (Feature 1)

### 5.1 Engine

`voice/useVoiceListener.ts` wraps the Web Speech API:

- `continuous = true`, `interimResults = true`, `maxAlternatives = 1`;
- `lang = navigator.language` (D4).

It does not reuse `SpeechInput`. Voice mode needs pause and resume, interim tracking and a silence
timer. `SpeechInput` stays as the mic button for text mode and is hidden in voice mode.

### 5.2 Sentence transcription

- Each **final** result (one phrase or sentence) is appended to the draft with a single space and
  shown at once.
- The latest **interim** result is shown greyed after the draft and replaced on every event.
- Results that arrive while the listener is paused are dropped (§5.5).

### 5.3 The 3-second rule

`SILENCE_MS = 3000`, exported for tests.

- **Every** result event, interim or final, restarts the timer.
- When the timer expires:
  - a pending interim result is taken as final;
  - if the trimmed draft is not empty, the **whole draft is sent as one message**
    (`chat.send(draft)`) and the draft is cleared;
  - if the draft is empty, nothing happens.
- Chrome emits no result events during silence, so "no event for 3 s" means "no speech for 3 s".
- Pausing mid-sentence doesn't send, because interim results keep arriving until the phrase is
  finalised (about 0.5–1 s after the speaker stops).
- A thin bar under the transcript drains over the 3 seconds after the last result. It refills when
  the admin speaks again.

### 5.4 Manual controls

| Control | What it does |
|---|---|
| **Send now** | Sends the draft immediately |
| **Clear** | Drops the draft and cancels the countdown |

There is no typing in voice mode; the textarea is replaced by the transcript (§8).

### 5.5 Half-duplex: the mic pauses while the agent talks

- From the send until the reply has finished playing, plus a 400 ms grace period, the listener is
  paused with `recognition.abort()`.
- Otherwise the agent's own voice would be transcribed and sent back as a new message, an echo
  loop. Web Speech capture doesn't reliably apply echo cancellation.
- Barge-in is a non-goal. The Stop button ends the reply instead.

### 5.6 Approvals

- While a tool waits for approval, the listener stays paused.
- A spoken message would supersede the approval, and the server would deny it (§2.3).
- The admin answers by clicking the card. The answer is sent automatically, the reply continues
  and is spoken, and listening resumes afterwards.
- Spoken approvals are a non-goal: a misheard "yes" must never approve a delete.

### 5.7 Restarts and errors

| Event | Handling |
|---|---|
| `end` while listening (Chrome stops after about 60 s, or after a long silence) | Restart at once |
| Error `no-speech` or `aborted` | Restart |
| Error `network` (also how Brave reports that it has no speech service) | Restart after 1 s, 2 s, then 4 s. After 3 failures in a row: paused, banner "Voice recognition is unavailable", **Retry** button |
| Error `not-allowed` or `service-not-allowed` | Switch off. Inline error: "Microphone access is blocked. Allow it in the browser's site settings." |
| Error `audio-capture` | Switch off. Inline error: "No microphone found." |
| Error `language-not-supported` | Retry once with `en-US` |
| Page hidden (`visibilitychange`) | Pause listening and cancel the countdown; the draft is kept. When the page is visible again, listening resumes and the countdown restarts if the draft isn't empty |

### 5.8 Browser support

| Browser | Voice mode |
|---|---|
| Chrome, Edge | Yes. The audio is recognised by the vendor's cloud service. Chrome's Google voices and Edge's "Microsoft … Online" voices can speak the reply (§6.7). |
| Safari 14.1+ (macOS, iOS) | Yes, via `webkitSpeechRecognition`. Continuous mode drops more often; §5.7 restarts it. |
| Firefox | No. The switch is disabled (§4.2). |

---

## 6. Part C: speaking (Feature 2)

### 6.1 What is spoken

- Only the assistant reply to a turn sent while voice is on. This includes a reply that was
  streaming when voice was turned on (D3) and the continuation after an approval.
- History loaded from the server is never spoken.
- Text parts are spoken in order.
- Reasoning and tool steps are not spoken. While tools run the status line says "Working…" (§8).
- A tool part in `approval-requested` is spoken as the **form** pointer.
- A stream error is spoken as the error pointer.

### 6.2 Speech script (`voice/speech-script.ts`, pure)

`buildSpeechScript(message, { final, error }): ISpeechSegment[]` returns segments of the form
`{ id, kind: 'prose' | 'pointer', text }`.

- Ids are stable as the message grows (`${partIndex}:${blockIndex}:${sentenceIndex}`).
- The queue enqueues each id once, so the function can run on every streamed update.

For each text part:

1. **Split** with `parseMarkdownIntoBlocks(part.text)` and drop whitespace-only blocks.
2. **Settle.**
   - Every block except the last is settled.
   - The last block settles when the part's `state` is `'done'`, or when `final` is true (the
     stream has ended).
   - For speed: if the unsettled last block is prose (§6.2 step 3), its complete sentences settle
     already. A sentence is complete when it ends in `. ! ? 。 ！ ？` followed by whitespace.
   - A half-streamed table or code fence is never spoken early, because it isn't prose.
3. **Classify** each settled block by how it starts.

| Block | Detected by | Spoken |
|---|---|---|
| prose: paragraph, heading, list, quote | anything not below | the cleaned text (§6.3) |
| **table** | the first line starts with `\|` | "Please take a look at this table." |
| **code** | ```` ``` ```` or `~~~` fence (not mermaid), or a 4-space indent | "Please take a look at this code." |
| **form**: a tool part in `approval-requested` | the part itself, not markdown | "I need your approval for this. Please take a look at this form." |
| diagram | ```` ```mermaid ```` | "Please take a look at this diagram." |
| formula | `$$` | "Please take a look at this formula." |
| image | the block is only `![…](…)` | "Please take a look at this image." |
| raw HTML | `<` | nothing |
| stream error | `chat.error` | "Something went wrong. Please take a look at the screen." |

4. **Merge.** Consecutive pointers of the same kind become one plural pointer: "Please take a look
   at these 2 tables."
5. **Pack.** Prose is split into sentences and packed into segments. The size limit depends on the
   engine: up to 300 characters for ElevenLabs, 180 for the browser voice (§6.7).
   - The first segment of a reply is its first sentence alone, so speech starts quickly.
   - With the browser voice, a single sentence longer than 180 characters is split at its last
     comma or space before the limit.

Example:

````
Here are your top customers this quarter.          →  "Here are your top customers this quarter."

| Name | Revenue |                                  →  "Please take a look at this table."
|---|---|
| Acme | 12,400 |

The query I used:                                   →  "The query I used:"

```sql                                              →  "Please take a look at this code."
select …
```

Acme leads by 40%. Want the full list?              →  "Acme leads by 40%. Want the full list?"
````

### 6.3 Prose cleanup

This is a port of `stripForTts` from the deleted `VoiceParser.tsx`.

- Heading markers, bold and italic markers, and HTML tags are removed.
- `[label](url)` is spoken as the label only. A bare URL is spoken as "the link on screen".
- Inline code is spoken as its content with `_` turned into a space (`agent_skills` → "agent
  skills"). Inline code longer than 40 characters is spoken as "this code".
- Each list item ends with a period if it doesn't end in punctuation, so items are read as
  separate sentences.
- Emoji, variation selectors and zero-width joiners are removed, and whitespace is collapsed.

### 6.4 Pointer wording

- Pointers are i18n strings `agent.voice.look.{table,code,form,diagram,formula,image,error}`,
  with `_other` plural forms, added in every locale that has an `agent` section.
- They use the UI language, so a Chinese UI speaks Chinese pointers. The TTS model must then be
  multilingual (D5).

### 6.5 Why the client says it, not the model

- It is deterministic: the model can't forget, and the pointer always matches what is rendered.
- It costs no tokens.
- It leaves the on-screen text unchanged. If the model were prompted to write "please look at this
  table", that sentence would appear in the transcript and the thread history too.

### 6.6 Speech queue (`voice/useSpeechQueue.ts`)

The queue plays segments in order through one of two engines. Both implement the same small
interface:

```ts
interface ISpeechEngine {
  id: 'elevenlabs' | 'browser';
  maxSegmentChars: number;                 // 300 | 180 (§6.2 step 5)
  unlock(): void;                          // called in the switch click (§4.3)
  speak(text: string, signal: AbortSignal): Promise<void>;  // resolves when playback ends
  prefetch?(text: string): void;           // ElevenLabs only
  stop(): void;
}
```

- **ElevenLabs engine** (`voice/engines/elevenlabs-engine.ts`)
  - Playback:
    - There is one `HTMLAudioElement`, created and unlocked in the switch click.
    - For each segment: `agentTts(text, signal)`, then a blob, then an object URL, then `play()`.
    - The next segment is prefetched while the current one plays (at most 2 requests in flight).
    - Object URLs are revoked when their segment ends.
  - Cache: pointer audio is cached in memory by text, because the same phrases repeat.
  - Autoplay blocked anyway (rare, mostly iOS): if `play()` rejects with `NotAllowedError`, the
    status line shows a "Tap to hear the reply" button. Tapping it plays the queue.
- **Browser engine** (`voice/engines/browser-engine.ts`): the browser's `speechSynthesis`, covered
  in §6.7.
- **Choosing the engine.** The voice settings (§8) have three choices:

  | Choice | What happens |
  |---|---|
  | **Auto** (default, D11) | ElevenLabs. The first 503 (not configured) switches to the browser voice for the rest of the session. |
  | **ElevenLabs** | The same, but a 503 also shows the note "ElevenLabs isn't configured; using the browser voice". |
  | **Browser voice** | Never calls `/api/agent/tts`, so it is free and needs no key. |

- **Per-segment failures.**
  - If ElevenLabs fails on a segment (anything other than 503), that segment is spoken by the
    browser voice.
  - If the browser voice fails, it retries once with an offline voice of the same language
    (§6.7).
  - If that fails too, the segment is skipped. Its text is on screen.
- **`active`** is true while the queue isn't empty, a request is in flight, or audio is playing.
  This drives the switch lock (§4.2).
- **`stop()`** stops the current engine and clears the queue. It runs on Stop and on unmount
  (thread switch, `/clear`, leaving the page).

### 6.7 Browser voice (Chrome's Google voices)

**This is possible.** Chrome exposes its voices to web pages through the Web Speech synthesis API
(`window.speechSynthesis`, `SpeechSynthesisUtterance`). The same code also serves Edge, Safari and
any other browser that has the API.

**Voices.** `speechSynthesis.getVoices()` lists the voices.

| Browser | Voices |
|---|---|
| Google Chrome (desktop) | Google voices, about 20 languages: "Google US English", "Google UK English Female", "Google 普通话（中国大陆）" and others. `localService: false`: they are synthesised on Google's servers, need a connection and send the text to Google. Also the system's own voices (`localService: true`): offline, usually plainer. |
| Chromium builds (not Google Chrome) | No Google voices. Only the system's voices. On Linux these come from speech-dispatcher and are often missing. |
| Edge | "Microsoft … Online (Natural)" voices (online), plus the system's voices. |
| Safari | The system's voices (macOS and iOS), offline. |

**How the engine handles Chrome's behaviour:**

| Chrome behaviour | Handling |
|---|---|
| `getVoices()` returns `[]` until the voices have loaded | Wait for the `voiceschanged` event, with a 2 s timeout, before the first `speak` and before opening the picker |
| `speak()` is refused without a user gesture on the page (Chrome 71+) | The switch click is the gesture. `unlock()` speaks an empty utterance inside it (§4.3). |
| Google voices stop mid-utterance after about 15 seconds of speech | Segments are at most 180 characters (§6.2 step 5): well under 15 s at normal rate |
| An utterance that is garbage-collected never fires `end` | Each utterance is kept in a field until its `end` or `error` |
| A queue left stuck by an earlier page | `speechSynthesis.cancel()` once when the engine starts |
| `error` with `interrupted` or `canceled` | Caused by our own `stop()`; ignored |
| `error` with `network` (Google voice offline) or `synthesis-failed` | Retry that segment once with an offline voice of the same language; otherwise skip it |
| `error` with `not-allowed` | Show "Tap to hear the reply" (as in §6.6) |

**Playback.**

- One utterance is spoken at a time. `speak()` resolves on `end`. Chrome's own queue is not used,
  so Stop and `active` stay exact.
- There is no audio stream to measure, so the "Speaking…" level bars animate on the utterance's
  `start` and `boundary` events instead.

**Default voice.**

- The first time, the engine picks a voice by language, using the recognition language (§5.1):
  1. a Google voice for that language;
  2. otherwise the system's default voice for that language;
  3. otherwise the browser's default voice.
- The admin can choose another voice in the picker (§8). The choice is saved by `voiceURI`.
- If the saved voice isn't on this machine, the engine picks a default as above.

---

## 7. Part D: server

### 7.1 `POST /api/agent/tts`

- **Route.** Added to `interface/agent-chat.controller.ts` (116 lines today), which uses
  `AgentAdminGuard`, so it is admin-only like the rest of the agent.
- **Body.** `agentTtsRoSchema = z.object({ text: z.string().trim().min(1).max(1000) }).strict()`.
  The limit allows a 300-character segment with room to spare.
- **Response.** An `audio/mpeg` stream. 400 for invalid input, 503 when `ELEVENLABS_API_KEY` is
  unset, 502 for an upstream error. These come from the existing `TtsService`, unchanged.
- **Wiring.** Add `TtsService` to `AiModule`'s `exports` and inject it in the agent controller.
  `AgentModule` already imports `AiModule`.
- **Contract.** `packages/openapi/src/agent/voice.ts` defines `AGENT_TTS = '/agent/tts'`, the
  schema, route registration and `agentTts(text, signal)`.
  - `agentTts` uses `fetch`, like the old `aiTtsStream`, because the body is binary.
  - It is exported from `packages/openapi/src/agent/index.ts`.
- **Why not reuse `/api/:baseId/ai/tts`.**
  - It is scoped to a base, and `/agent` has none.
  - It lets any base reader in, not only the admin.
  - Leave it alone for now (D7).
- **Cost.** ElevenLabs bills per character, so a 600-character reply costs about 600 credits.
  Pointer audio is cached on the client.

### 7.2 Voice and model

- `ELEVENLABS_MODEL_ID` defaults to `eleven_turbo_v2`, which is English only.
- For other languages, set `eleven_flash_v2_5` (multilingual, low latency) (D5).
- The voice comes from `ELEVENLABS_VOICE_ID`.
- Neither needs a code change.
- The browser voice (§6.7) needs nothing on the server.

### 7.3 Voice hint for the model (optional, D9)

- **Schema.** `agentChatContextSchema` (`packages/openapi/src/agent/chat.ts:7`, strict) gains
  `voice: z.boolean().optional()`. The client sends `context.voice = true` while voice is on.
- **Prompt.** `RunTurn` and `ResumeTurn` pass the flag through `gate.launch` to
  `buildSystemPrompt` (`apps/nestjs-backend/src/features/agent/runtime/context-builder.ts:73`) as
  `IPromptParts.voice`.
- **Placement.** It is added as the **last** section, so turning voice on or off doesn't change
  the cached prompt prefix:

  ```
  ## Voice
  The admin is talking to you by voice and hears your reply read aloud. Answer in short, plain
  spoken sentences. Put tables, code and long lists in markdown as usual; the app asks the admin
  to look at them, so do not repeat their contents in prose.
  ```

- The flag applies per turn. It is not stored on the thread.

---

## 8. Part E: UI

Text mode (voice off): today's composer plus the footer row.

```
┌──────────────────────────────────────────────────────────┐
│ Ask the agent… type / for skills, /clear for a new chat  │ [🎙]
│                                                          │ [↑]
├──────────────────────────────────────────────────────────┤
│ 〰 Voice ○                                                │
└──────────────────────────────────────────────────────────┘
```

Voice mode (voice on): the textarea becomes the live transcript.

```
┌──────────────────────────────────────────────────────────┐
│ ● Hearing you…                                           │
│ Show me the top five customers by revenue this quarter   │
│ and compare them with last quarter                        │  ← interim, grey
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭  sending in 2 s     [Clear] [Send now]│
├──────────────────────────────────────────────────────────┤
│ 〰 Voice ●                                                │
└──────────────────────────────────────────────────────────┘
```

| Phase | Status line | Buttons | Switch |
|---|---|---|---|
| listening, empty draft | 🎙 Listening… (pulsing) | none | can turn off |
| hearing or countdown | ● Hearing you… / sending in N s | Clear, Send now | can turn off |
| thinking (`submitted`, or streaming before any speakable text) | Thinking… | Stop | locked |
| working (a tool step is running) | Working… | Stop | locked |
| speaking | 🔊 Speaking… (level bars) | Stop | locked |
| approval | Waiting for your approval: use the card above | none | can turn off |
| paused (error or hidden page) | the reason | Retry, where it applies | can turn off |

- The status line is `aria-live="polite"`.
- The switch's tooltip explains the lock and is linked with `aria-describedby`.
- The message list is unchanged: the reply renders as it does today while it is spoken.

**Voice settings.** A gear button next to the switch opens a popover (`VoiceSettings.tsx`). It is
disabled while the switch is locked, so the engine never changes mid-reply.

```
┌ Voice ─────────────────────────────────────┐
│ Speak replies with                         │
│ (•) Auto (ElevenLabs, else browser)        │
│ ( ) ElevenLabs                             │
│ ( ) Browser voice                          │
│                                            │
│ Browser voice  [Google US English    ▾] ▶  │  ← opens the picker; ▶ preview
└────────────────────────────────────────────┘
```

- **The picker.** The browser voice opens the existing `VoiceSelector` dialog
  (`components/ai-elements/voice-selector.tsx`) with search.
  - Voices are grouped as "Online (Google / Microsoft)" (`localService: false`) and "This device"
    (`localService: true`).
  - The recognition language's voices are listed first.
  - Each row shows the voice name and language, and has a preview button that says "Hello, I'm
    your agent." in that voice.
- **Storage.** The settings `{ engine, browserVoiceURI }` are stored per browser in `localStorage`
  (`agent.voice.settings`). They are kept across reloads (D12), unlike the on/off switch (D8).
- **When the picker is empty.** If the browser has no voices (for example Chromium on Linux
  without speech-dispatcher), the picker says "This browser has no voices" and Auto keeps using
  ElevenLabs.

---

## 9. State machine

`voice/useVoiceConversation.ts` composes `useAgentChat`, `useVoiceListener` and `useSpeechQueue`.
The phase comes from a pure function, so it can be tested on its own:

```ts
voicePhase({ enabled, busy, speakerActive, awaitingApproval, listener })
  → 'off' | 'listening' | 'hearing' | 'thinking' | 'working' | 'speaking' | 'approval' | 'paused'
switchLocked = enabled && (busy || speakerActive)
```

| From | Event | To | Side effects |
|---|---|---|---|
| off | switch on | listening | unlock audio, start recognition (§4.3) |
| listening | result event | hearing | append or show text, restart the 3 s timer |
| hearing | 3 s without results, draft not empty | thinking | `chat.send(draft)`, clear draft, pause mic |
| hearing | Send now | thinking | the same |
| hearing | Clear | listening | drop the draft, stop the timer |
| thinking / working | first settled segment | speaking | queue starts |
| speaking | stream ends, queue drains | listening | resume mic after 400 ms |
| any responding phase | Stop | listening | `chat.stop()` + cancel run, `speaker.stop()` |
| speaking or thinking | tool part `approval-requested` | approval | speak the form pointer, keep the mic paused |
| approval | admin clicks Approve or Deny | thinking | auto-send (existing) |
| any | mic error (§5.7) | paused or off | inline error |
| any phase that isn't locked | switch off | off | draft back to the textarea (§4.4) |

---

## 10. Files and phases

New files, all under `voice/` (each well under 500 lines):

| File | Purpose |
|---|---|
| `voice-store.ts` | zustand `enabled` |
| `speech-script.ts` | `buildSpeechScript`, prose cleanup, block classification |
| `useVoiceListener.ts` | recognition, draft, interim, silence timer, restarts |
| `useSpeechQueue.ts` | segment queue, engine choice, fallbacks |
| `engines/elevenlabs-engine.ts` | `/api/agent/tts` fetch, prefetch, cache, audio element |
| `engines/browser-engine.ts` | `speechSynthesis`: voice loading, default voice, Chrome workarounds (§6.7) |
| `voice-settings.ts` | `{ engine, browserVoiceURI }` in `localStorage` |
| `useVoiceConversation.ts` | phase, lock, wiring to the chat |
| `VoiceComposer.tsx` | transcript, status line, countdown, buttons |
| `VoiceSwitch.tsx` | the switch and its lock tooltip |
| `VoiceSettings.tsx` | engine choice and the browser voice picker (reuses `VoiceSelector`) |
| `voice.spec.tsx` | tests (§11) |

Changed files:

- `components/AgentComposer.tsx`: footer row with the switch; renders `VoiceComposer` when voice
  is on.
- `AgentChatView.tsx`: runs `useVoiceConversation`; sends `context.voice`.
- `packages/openapi/src/agent/voice.ts` (new) and `index.ts`.
- `packages/openapi/src/agent/chat.ts`: `voice` flag (P4 only).
- `apps/nestjs-backend/src/features/ai/ai.module.ts`: export `TtsService`.
- `apps/nestjs-backend/src/features/agent/interface/agent-chat.controller.ts`: `POST tts`.
- `context-builder.ts`, `run-turn.usecase.ts`, `resume-turn.usecase.ts`: the voice section (P4
  only).
- `packages/common-i18n/src/locales/*/common.json`: `agent.voice.*`.

Phases (one commit each):

| Phase | Content | Done when |
|---|---|---|
| P0 | `POST /api/agent/tts` and the openapi client | e2e: 403 for non-admins, 400 for an empty or too long text, 503 without a key |
| P1 | `speech-script.ts` | unit table of §11 passes |
| P2 | `useVoiceListener`, `useSpeechQueue` and both engines | fake-timer, fake-audio and fake-`speechSynthesis` tests pass |
| P3 | conversation hook, switch, voice composer, voice settings and picker, i18n | component tests pass; manual run in Chrome with a Google voice and with ElevenLabs |
| P4 | voice hint in the system prompt (D9) | context-builder unit test passes |
| P5 | manual matrix (§11.3) and notes in this file | every row checked |

---

## 11. Testing

### 11.1 Frontend (vitest, `@/test-utils`, as in `agent.spec.tsx`)

- **Speech script.**
  - Prose only. A table between two paragraphs. A sql fence. A mermaid fence. Two tables in a row
    become the plural pointer.
  - An approval tool part gives the form pointer.
  - A half-streamed table is not spoken until settled.
  - Sentences of a streaming paragraph settle one by one, and their ids stay stable as text grows.
  - Prose cleanup: links, bare URLs, `agent_skills`, list items, emoji.
  - `state: 'done'` settles the last block.
- **Listener**, with a fake `SpeechRecognition` and `vi.useFakeTimers()`:
  - a final result followed by 3 s of silence sends once, with the whole draft;
  - an interim result at 2.9 s resets the timer;
  - an empty draft never sends;
  - a pending interim result is included at expiry;
  - results while paused are dropped;
  - `end` restarts recognition;
  - `not-allowed` turns voice off.
- **Queue**, with fake `fetch` and `Audio`:
  - segments play in order with one request prefetched;
  - with Auto, a 503 switches to the browser engine;
  - with Browser voice, `/api/agent/tts` is never called;
  - `stop()` aborts everything;
  - pointer audio is fetched once.
- **Browser engine**, with a fake `speechSynthesis`:
  - `speak` waits for `voiceschanged` when `getVoices()` is empty at first;
  - a Google voice is preferred for the language;
  - a saved `voiceURI` that has gone falls back to a default;
  - a 400-character sentence is spoken as segments of at most 180 characters;
  - `interrupted` after `stop()` is not an error;
  - a `network` error retries the segment once with an offline voice.
- **Phase and lock.**
  - `switchLocked` is true while busy or speaking.
  - It is false during an approval and after Stop.
  - The switch is disabled when `SpeechRecognition` is missing.

### 11.2 Backend

- e2e in the style of `apps/nestjs-backend/test/agent-chat.e2e-spec.ts`: `/api/agent/tts` returns
  403 for a non-admin, 400 for empty or 1,001-character text, and 503 when the key is unset (the
  test env doesn't set it).
- Unit test in `runtime.spec.ts`: the voice section is last when `voice` is true and absent
  otherwise.

### 11.3 Manual matrix

| Check | Chrome | Edge | Safari | Firefox |
|---|---|---|---|---|
| Switch on, permission prompt, listening | ✓ | ✓ | ✓ | disabled |
| Speak two sentences with a pause; sent after 3 s as one message | ✓ | ✓ | ✓ | – |
| Reply with a table and code: pointers spoken, rest read aloud | ✓ | ✓ | ✓ | – |
| Switch locked while speaking; Stop unlocks it | ✓ | ✓ | ✓ | – |
| Approval: form pointer spoken, mic paused, click, reply continues | ✓ | ✓ | ✓ | – |
| Microphone denied: switch off with an inline error | ✓ | ✓ | ✓ | – |
| `ELEVENLABS_API_KEY` unset: browser voice used | ✓ | ✓ | ✓ | – |
| Browser voice chosen: a Google voice (Chrome) or Online voice (Edge) speaks a long reply without cutting off | ✓ | ✓ | system voice | – |
| Picker: voices listed and grouped, preview plays, choice kept after a reload | ✓ | ✓ | ✓ | – |
| Offline with a Google voice: falls back to a device voice, or the segment is skipped | ✓ | – | – | – |
| Hidden tab pauses listening; returning resumes it | ✓ | ✓ | ✓ | – |

---

## 12. Decisions (confirmed 2026-10-27)

| # | Question | Decision |
|---|---|---|
| D1 | What is a "form"? | The approval card: the only form-like UI in a reply today. Any future ask-the-admin form would use the same pointer. |
| D2 | When does "responding" end? | When the reply has finished **playing**, not just streaming. Stop ends it early. |
| D3 | Can voice be turned on mid-reply? | Yes. That reply is spoken from its start. |
| D4 | Recognition language | `navigator.language`. The composer mic in text mode keeps `en-US`. |
| D5 | Text-to-speech engines | Two engines: ElevenLabs through `/api/agent/tts`, and the browser voice (Chrome's Google voices, §6.7). The admin chooses in the voice settings. Set `ELEVENLABS_MODEL_ID=eleven_flash_v2_5` if the admin speaks anything other than English. |
| D6 | Where does voice appear? | The `/agent` page and the table side panel (shared composer). |
| D7 | The old `/api/:baseId/ai/tts` | Keep it for now. Remove it in a separate cleanup once nothing needs it. |
| D8 | Keep the switch on across reloads? | No, because the mic and audio need a fresh click. |
| D9 | Voice hint in the system prompt | Yes (P4), so spoken replies stay short. |
| D10 | Approvals by voice? | No. Click only. |
| D11 | Default engine | **Auto**: ElevenLabs when configured, otherwise the browser voice. Choose **Browser voice** to use Chrome's Google voices with no ElevenLabs cost. |
| D12 | Where are voice settings kept? | Per browser, in `localStorage`. Voices differ between machines, so the choice isn't stored on the server. |

## 13. Risks

- **Privacy.** Chrome and Edge send microphone audio to their cloud recognisers. The agent is
  admin-only, and the switch tooltip says so the first time.
- **Noise.** Steady background noise can keep producing interim results, so the timer never
  expires. Send now covers this, and the status line shows "Hearing you…" so the cause is
  visible.
- **Safari continuous mode** stops more often. The restarts in §5.7 hide it, at the cost of a
  short gap.
- **Autoplay** can still be refused on iOS after a long silence. "Tap to hear the reply" covers it
  (§6.6).
- **Cost.** Every spoken character is billed by ElevenLabs. The voice hint keeps replies short, and
  pointers are cached. The browser voice costs nothing.
- **Browser voice privacy.** Chrome's Google voices and Edge's Online voices send the reply text to
  Google or Microsoft. The picker labels them "Online". The device voices stay on the machine.
- **Browser voice quality varies by machine.** A Google voice in Chrome sounds good. Chromium on
  Linux may have no voices at all. Safari uses the system's voices. If no voice is available, the
  reply is shown and not spoken.
- **Chrome's 15-second cut-off.** Google voices stop after about 15 seconds of speech. This is an
  old, unfixed Chrome bug and is handled by the 180-character segments. If it shows up again (for
  example with a slow speaking rate), the segment limit is the setting to lower.
