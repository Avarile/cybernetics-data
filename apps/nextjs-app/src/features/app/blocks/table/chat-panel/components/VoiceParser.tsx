'use client';

import { aiTtsStream } from '@teable/openapi';
import { Mic, MicOff, StopCircle, Volume2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PromptInputButton,
  usePromptInputController,
} from '../../../../../../components/ai-elements/prompt-input';

// ISpeechRecognition, ISpeechRecognitionEvent and the Window constructors come
// from src/types.d/speech-recognition.d.ts — declared once globally because more
// than one module consumes them.

// Strip markdown and emoji from AI output before sending to TTS.
// Keeps only plain readable prose — tables, code blocks, and decorative
// characters add noise and confuse the speech model.
function stripForTts(raw: string): string {
  return (
    raw
      // Fenced code blocks (``` or ~~~)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/~~~[\s\S]*?~~~/g, '')
      // Markdown table rows: any line fully wrapped in pipes
      .replace(/^\|.+\|$/gm, '')
      // Leftover table separator lines (--|--|-- or :---:)
      .replace(/^[-|: ]+$/gm, '')
      // Inline code
      .replace(/`[^`\n]+`/g, '')
      // ATX headings (# Heading → Heading)
      .replace(/^#{1,6}\s+/gm, '')
      // Bold / italic markers — preserve inner text
      .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
      .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1')
      // Images: ![alt](url) → alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Links: [label](url) → label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // HTML tags
      .replace(/<[^>]+>/g, '')
      // Emojis (Extended_Pictographic covers all standard emoji code points)
      .replace(/\p{Extended_Pictographic}/gu, '')
      // Leftover variation selectors and ZWJ from emoji sequences
      .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
      // Collapse multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

interface IVoiceParserProps {
  baseId: string;
  isStreaming: boolean;
  lastAssistantMessage: string;
}

export const VoiceParser = ({ baseId, isStreaming, lastAssistantMessage }: IVoiceParserProps) => {
  const { t } = useTranslation('common');
  const controller = usePromptInputController();

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const prevIsStreamingRef = useRef(false);
  // Stable ref to setInput — avoids re-initialising recognition on every text change
  const setInputRef = useRef(controller.textInput.setInput);
  setInputRef.current = controller.textInput.setInput;
  const inputValueRef = useRef(controller.textInput.value);
  inputValueRef.current = controller.textInput.value;
  // Text already in the input when dictation started; the transcript is appended to it.
  const dictationBaseRef = useRef('');

  const sttSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // ---------------------------------------------------------------------------
  // TTS helpers
  // ---------------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    ttsAbortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsSpeaking(false);
  }, []);

  const playTts = useCallback(
    async (text: string, fromUserGesture = false) => {
      if (!text.trim()) return;

      stopSpeaking();

      // Unlock the audio element within the current user gesture so that the
      // subsequent play() call after the async fetch is not blocked by autoplay
      // policy (browsers expire transient activation after ~5 s).
      if (fromUserGesture) {
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        audioRef.current.src = '';
        audioRef.current.load();
      }

      const cleanText = stripForTts(text);
      if (!cleanText) return;

      const abortCtrl = new AbortController();
      ttsAbortRef.current = abortCtrl;

      try {
        const res = await aiTtsStream(baseId, cleanText, abortCtrl.signal);
        if (!res.ok || !res.body) {
          console.error('[TTS] bad response:', res.status);
          return;
        }

        const blob = await res.blob();
        if (blob.size === 0) {
          console.error('[TTS] received empty audio blob');
          return;
        }

        const url = URL.createObjectURL(blob);

        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        const audio = audioRef.current;
        audio.onerror = (e) => {
          console.error('[TTS] audio element error:', e);
          URL.revokeObjectURL(url);
          setIsSpeaking(false);
        };
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setIsSpeaking(false);
        };
        audio.src = url;
        setIsSpeaking(true);
        await audio.play();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[TTS] play error:', err);
        setIsSpeaking(false);
      }
    },
    [baseId, stopSpeaking]
  );

  // ---------------------------------------------------------------------------
  // Speech recognition
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!sttSupported) return;

    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: ISpeechRecognitionEvent) => {
      // Rebuild the full transcript from all results so interim updates replace each other.
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0]?.transcript ?? '';
      }
      if (transcript.trim()) {
        const base = dictationBaseRef.current;
        setInputRef.current(base ? `${base} ${transcript.trim()}` : transcript.trim());
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [sttSupported]);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsVoiceActive(true);
      dictationBaseRef.current = inputValueRef.current.trimEnd();
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        // recognition already started or browser blocked mic
      }
    }
  }, [isListening]);

  // Auto-play TTS for the reply to a dictated message. Voice mode then turns
  // off, so later typed messages aren't read aloud unless the mic is used again.
  // fromUserGesture is false here — we rely on sticky activation from the
  // prior mic-button click; if the browser blocks it the error is logged.
  useEffect(() => {
    const justFinished = prevIsStreamingRef.current && !isStreaming;
    prevIsStreamingRef.current = isStreaming;

    if (!justFinished || !isVoiceActive) return;
    setIsVoiceActive(false);
    void playTts(lastAssistantMessage, false);
  }, [isStreaming, isVoiceActive, lastAssistantMessage, playTts]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      ttsAbortRef.current?.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    },
    []
  );

  const canSpeak = !!lastAssistantMessage && !isStreaming;
  const readAloudLabel = isSpeaking
    ? t('ai.chat.stopReading', 'Stop reading')
    : t('ai.chat.readAloud', 'Read response aloud');
  const micLabel = isListening
    ? t('ai.chat.stopListening', 'Stop listening')
    : t('ai.chat.voiceInput', 'Voice input');

  return (
    <div className="flex items-center gap-0.5">
      {/* Read-aloud button — always visible, play/stop toggle */}
      <PromptInputButton
        tooltip={readAloudLabel}
        aria-label={readAloudLabel}
        disabled={!canSpeak && !isSpeaking}
        onClick={() => (isSpeaking ? stopSpeaking() : void playTts(lastAssistantMessage, true))}
      >
        {isSpeaking ? (
          <StopCircle className="size-4 text-primary" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </PromptInputButton>

      {/* Mic button — only rendered when STT is available */}
      {sttSupported && (
        <div className="relative inline-flex">
          {isListening && (
            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-destructive/25" />
          )}
          <PromptInputButton
            tooltip={micLabel}
            aria-label={micLabel}
            aria-pressed={isListening}
            onClick={toggleListening}
            className={isListening ? 'text-destructive' : undefined}
          >
            {isListening ? (
              <MicOff className="relative size-4" />
            ) : (
              <Mic className="relative size-4" />
            )}
          </PromptInputButton>
        </div>
      )}
    </div>
  );
};
