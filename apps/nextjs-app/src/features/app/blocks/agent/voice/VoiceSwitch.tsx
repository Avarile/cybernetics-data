import {
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { AudioLines } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useId } from 'react';
import type { IVoiceConversation, IVoiceNotice } from './useVoiceConversation';

export const useVoiceNoticeText = () => {
  const { t } = useTranslation('common');
  return (notice: IVoiceNotice) =>
    ({
      blocked: t(
        'agent.voice.error.blocked',
        "Microphone access is blocked. Allow it in the browser's site settings."
      ),
      'no-microphone': t('agent.voice.error.noMicrophone', 'No microphone found.'),
      unavailable: t('agent.voice.error.unavailable', 'Voice recognition is unavailable.'),
      'not-configured': t(
        'agent.voice.error.notConfigured',
        "ElevenLabs isn't configured; using the browser voice."
      ),
    })[notice];
};

/**
 * The Voice switch (voice design §4): disabled without speech recognition, and locked on while
 * the agent responds. The tooltip says why.
 */
export const VoiceSwitch = ({
  voice,
  disabled,
  onToggle,
  children,
}: {
  voice: IVoiceConversation;
  disabled?: boolean;
  onToggle: (on: boolean) => void;
  /** Rendered after the switch, before a notice (the settings button). */
  children?: ReactNode;
}) => {
  const { t } = useTranslation('common');
  const id = useId();
  const noticeText = useVoiceNoticeText();
  let tip = t(
    'agent.voice.hint',
    'Talk with the agent: it listens, sends after 3 seconds of silence and reads replies aloud. Chrome and Edge recognise speech in their cloud.'
  );
  if (!voice.supported) tip = t('agent.voice.unsupported', 'Voice needs Chrome, Edge or Safari');
  else if (voice.locked) {
    tip = t(
      'agent.voice.locked',
      'Voice can be turned off when the agent has finished. Use Stop to end the reply now.'
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <AudioLines className="size-3.5 shrink-0 text-muted-foreground" />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {t('agent.voice.label', 'Voice')}
      </Label>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                id={id}
                className="scale-75"
                checked={voice.enabled}
                disabled={disabled || !voice.supported || voice.locked}
                aria-describedby={`${id}-tip`}
                onCheckedChange={onToggle}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-xs">{tip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span id={`${id}-tip`} className="sr-only">
        {tip}
      </span>
      {children}
      {voice.notice && (
        <span role="alert" className="text-xs text-destructive">
          {noticeText(voice.notice)}
        </span>
      )}
    </div>
  );
};
