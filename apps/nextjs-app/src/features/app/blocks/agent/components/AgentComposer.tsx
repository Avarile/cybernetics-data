import { Button, Textarea, cn } from '@teable/ui-lib/shadcn';
import { ArrowUp, Square } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { SpeechInput } from '@/components/ai-elements/speech-input';

export interface IAgentSkillOption {
  name: string;
  description?: string | null;
}

export interface IAgentComposerProps {
  busy: boolean;
  disabled?: boolean;
  skills?: IAgentSkillOption[];
  onSend: (text: string) => void;
  onStop: () => void;
}

/** Skills that match what follows a leading `/`. */
export const matchSkills = (value: string, skills: IAgentSkillOption[]) => {
  const m = /^\/([\w-]*)$/.exec(value.trim());
  if (!m) return [];
  return skills.filter((s) => s.name.startsWith(m[1].toLowerCase())).slice(0, 8);
};

/** Input with send/stop, voice, and a `/` skill picker (design §13). */
export const AgentComposer = ({
  busy,
  disabled,
  skills = [],
  onSend,
  onStop,
}: IAgentComposerProps) => {
  const { t } = useTranslation('common');
  const [value, setValue] = useState('');
  const suggestions = useMemo(() => matchSkills(value, skills), [value, skills]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <div className="relative border-t p-2">
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label={t('agent.composer.skills', 'Skills')}
          className="absolute inset-x-2 bottom-full mb-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => setValue(`/${s.name} `)}
              >
                <span className="font-medium">/{s.name}</span>
                {s.description && (
                  <span className="ml-2 line-clamp-1 text-xs text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          disabled={disabled}
          rows={2}
          className="max-h-48 min-h-[44px] resize-none"
          placeholder={t('agent.composer.placeholder', 'Ask the agent… type / for skills')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <SpeechInput
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={disabled || busy}
            onTranscriptionChange={(text) => setValue((v) => (v ? `${v} ${text}` : text))}
          />
          {busy ? (
            <Button
              size="icon"
              variant="secondary"
              className="size-8"
              title={t('agent.composer.stop', 'Stop')}
              onClick={onStop}
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className={cn('size-8')}
              title={t('agent.composer.send', 'Send')}
              disabled={disabled || !value.trim()}
              onClick={submit}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
