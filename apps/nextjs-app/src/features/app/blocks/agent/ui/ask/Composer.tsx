import { Button, Textarea } from '@teable/ui-lib/shadcn';
import { ArrowUp, Star } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SpeechInput } from '@/components/ai-elements/speech-input';
import { completed, type ISuggestion } from '../../model/commands';
import type { IVoiceConversation } from '../../voice/useVoiceConversation';
import { VoiceComposer } from '../../voice/VoiceComposer';
import { VoiceSettings } from '../../voice/VoiceSettings';
import { VoiceSwitch } from '../../voice/VoiceSwitch';

/** A query runs once the input has been still this long (scope design §6.4). */
export const SEARCH_IDLE_MS = 3000;

export interface IAgentComposerProps {
  disabled?: boolean;
  /** A search is running. */
  busy?: boolean;
  placeholder: string;
  /** What the list under the input offers for this text. */
  suggestionsFor: (value: string) => ISuggestion[];
  /** Why the last Enter did nothing (an unknown command or name), under the input. */
  hint?: string;
  /** Enter or Send. Returns true when the input should be cleared (an applied command). */
  onSubmit: (text: string) => boolean;
  /** The input was still for SEARCH_IDLE_MS with this text in it. */
  onIdle: (text: string) => void;
  /** A base or table picked from the list. */
  onPick: (suggestion: ISuggestion) => void;
  /** Every change of the text (the cycle holds while a query is being typed). */
  onChange?: (text: string) => void;
  /** Voice conversation (voice design §4); without it there is no Voice switch. */
  voice?: IVoiceConversation;
}

const describe = (s: ISuggestion, t: (k: string, d: string) => string) => {
  if (s.kind === 'base') return t('agent.composer.baseOption', 'database');
  if (s.kind === 'table') return t('agent.composer.tableOption', 'table');
  return s.name === 'base'
    ? t('agent.composer.baseCommand', '<name>: choose the database')
    : t('agent.composer.tableCommand', '<name>: choose the table');
};

/**
 * The ask panel's command line (scope design §6): `/base` and `/table` with an autocomplete list
 * (↑/↓ move, Tab completes, Enter applies, Escape closes), and plain text, which is searched on
 * Enter, on Send, or once the input has been still for 3 s. A query stays in the input to be
 * refined. With voice on, the textarea gives way to the live transcript (voice design §8).
 */
export const AgentComposer = ({
  disabled,
  busy,
  placeholder,
  suggestionsFor,
  hint,
  onSubmit,
  onIdle,
  onPick,
  onChange,
  voice,
}: IAgentComposerProps) => {
  const { t } = useTranslation('common');
  const id = useId();
  const [value, setValue] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestions = useMemo(() => suggestionsFor(value), [suggestionsFor, value]);
  const open = !dismissed && suggestions.length > 0;
  const current = open ? suggestions[Math.min(active, suggestions.length - 1)] : undefined;

  // one timer, restarted by every change: still for 3 s, the text goes to onIdle
  const idle = useRef(onIdle);
  idle.current = onIdle;
  useEffect(() => {
    if (!value.trim()) return;
    const timer = setTimeout(() => {
      if (!composing.current) idle.current(value);
    }, SEARCH_IDLE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const change = (text: string) => {
    setValue(text);
    setActive(0);
    setDismissed(false);
    onChange?.(text);
  };
  const pick = (s: ISuggestion) => {
    if (s.kind === 'command') return change(completed(s));
    onPick(s);
    change('');
  };
  const submit = () => {
    if (disabled || !value.trim()) return;
    if (onSubmit(value)) change('');
  };
  const keys: Record<string, (e: KeyboardEvent<HTMLTextAreaElement>) => boolean> = {
    ArrowDown: () => {
      if (!open) return false;
      setActive((active + 1) % suggestions.length);
      return true;
    },
    ArrowUp: () => {
      if (!open) return false;
      setActive((active - 1 + suggestions.length) % suggestions.length);
      return true;
    },
    Tab: () => {
      if (!current) return false;
      change(completed(current));
      return true;
    },
    Escape: () => {
      if (!open) return false;
      setDismissed(true);
      return true;
    },
    Enter: (e) => {
      if (e.shiftKey || e.nativeEvent.isComposing) return false;
      if (current) pick(current);
      else submit();
      return true;
    },
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!keys[e.key]?.(e)) return;
    e.preventDefault();
    // the cockpit's own keys (Escape) stay out of the list
    e.stopPropagation();
  };

  const voiceOn = Boolean(voice?.enabled);
  /** Typed text starts the voice draft; a draft not sent comes back to the textarea. */
  const toggleVoice = (on: boolean) => {
    if (!voice) return;
    if (on) {
      voice.turnOn(value);
      change('');
    } else {
      const spoken = voice.turnOff();
      if (spoken) change(spoken);
    }
  };
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className="relative border-t p-2">
      {!voiceOn && open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t('agent.composer.suggestions', 'Suggestions')}
          className="absolute inset-x-2 bottom-full mb-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.kind === 'command' ? s.name : s.id}
              id={optionId(i)}
              role="option"
              aria-selected={s === current}
            >
              <button
                type="button"
                tabIndex={-1}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${s === current ? 'bg-accent' : ''}`}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(s)}
              >
                <span className="font-medium">{s.kind === 'command' ? `/${s.name}` : s.name}</span>
                {s.kind === 'base' && s.isDefault && (
                  <Star className="size-3 text-amber-400" fill="currentColor" aria-hidden />
                )}
                <span className="ml-auto line-clamp-1 text-xs text-muted-foreground">
                  {describe(s, t)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {voiceOn && voice ? (
        <VoiceComposer voice={voice} onStop={() => voice.stopSpeech()} />
      ) : (
        <div className="flex items-end gap-2">
          <Textarea
            ref={input}
            value={value}
            disabled={disabled}
            rows={2}
            role="combobox"
            aria-label={t('agent.composer.label', 'Search or command')}
            aria-expanded={open}
            aria-controls={open ? `${id}-list` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(suggestions.indexOf(current)) : undefined}
            className="max-h-48 min-h-[44px] resize-none"
            placeholder={placeholder}
            onChange={(e) => change(e.target.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={onKeyDown}
          />
          <div className="flex flex-col gap-1">
            <SpeechInput
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={disabled}
              onTranscriptionChange={(text) => change(value ? `${value} ${text}` : text)}
            />
            <Button
              size="icon"
              className="size-8"
              title={t('agent.composer.send', 'Send')}
              aria-busy={busy}
              disabled={disabled || !value.trim()}
              onClick={submit}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      )}
      {hint && !voiceOn && (
        <div role="status" className="px-1 pt-1 text-[10px] tracking-wider text-amber-500">
          {hint}
        </div>
      )}
      {voice && (
        <div className="mt-1.5">
          <VoiceSwitch voice={voice} disabled={disabled} onToggle={toggleVoice}>
            <VoiceSettings voice={voice} />
          </VoiceSwitch>
        </div>
      )}
    </div>
  );
};
