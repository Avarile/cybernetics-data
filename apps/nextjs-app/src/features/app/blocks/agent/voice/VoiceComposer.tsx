import { Button, cn } from '@teable/ui-lib/shadcn';
import { Loader2, Mic, MicOff, ShieldQuestion, Square, Volume2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import type { IVoiceConversation, IVoicePhase } from './useVoiceConversation';
import { SILENCE_MS } from './voice-listener';

/** Milliseconds until `deadline`, ticking while there is one. */
const useRemaining = (deadline?: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : undefined;
};

const PhaseIcon = ({ phase }: { phase: IVoicePhase }) => {
  const className = 'size-3.5 shrink-0';
  switch (phase) {
    case 'hearing':
      return <Mic className={cn(className, 'text-destructive')} />;
    case 'thinking':
    case 'working':
      return <Loader2 className={cn(className, 'animate-spin')} />;
    case 'speaking':
      return <Volume2 className={cn(className, 'animate-pulse text-primary')} />;
    case 'approval':
      return <ShieldQuestion className={cn(className, 'text-amber-600')} />;
    case 'paused':
    case 'off':
      return <MicOff className={className} />;
    default:
      return <Mic className={cn(className, 'animate-pulse')} />;
  }
};

/** Voice mode in place of the textarea (voice design §8): status, live transcript, countdown. */
export const VoiceComposer = ({
  voice,
  onStop,
}: {
  voice: IVoiceConversation;
  onStop: () => void;
}) => {
  const { t } = useTranslation('common');
  const { listener, phase } = voice;
  const remaining = useRemaining(listener.deadline);
  const heard = Boolean(listener.draft || listener.interim);
  const counting = heard && remaining !== undefined && !voice.locked;
  const labels: Record<IVoicePhase, string> = {
    off: '',
    listening: t('agent.voice.status.listening', 'Listening…'),
    hearing: t('agent.voice.status.hearing', 'Hearing you…'),
    thinking: t('agent.voice.status.thinking', 'Thinking…'),
    working: t('agent.voice.status.working', 'Working…'),
    speaking: t('agent.voice.status.speaking', 'Speaking…'),
    approval: t('agent.voice.status.approval', 'Waiting for your approval: use the card above'),
    paused: t('agent.voice.status.paused', 'Paused'),
  };

  return (
    <div className="space-y-1.5" data-testid="agent-voice-composer">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <PhaseIcon phase={phase} />
        <span>{labels[phase]}</span>
        {counting && (
          <span>
            ·{' '}
            {t('agent.voice.status.sendingIn', 'sending in {{seconds}} s', {
              seconds: Math.ceil(remaining / 1000),
            })}
          </span>
        )}
      </div>
      <div
        className="max-h-48 min-h-[44px] overflow-y-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-sm"
        data-testid="agent-voice-transcript"
      >
        {heard ? (
          <>
            {listener.draft}
            {listener.interim && (
              <span className="text-muted-foreground">
                {listener.draft ? ' ' : ''}
                {listener.interim}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">
            {t('agent.voice.placeholder', 'Say something…')}
          </span>
        )}
      </div>
      <div className="h-0.5 overflow-hidden rounded bg-muted">
        {counting && (
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-linear"
            style={{ width: `${(remaining / SILENCE_MS) * 100}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {voice.speech.blocked && (
          <Button size="xs" onClick={voice.tapToHear}>
            <Volume2 className="size-3.5" />
            {t('agent.voice.tapToHear', 'Tap to hear the reply')}
          </Button>
        )}
        {listener.status === 'failed' && (
          <Button size="xs" variant="outline" onClick={voice.retry}>
            {t('agent.voice.retry', 'Retry')}
          </Button>
        )}
        {heard && !voice.locked && (
          <>
            <Button size="xs" variant="ghost" onClick={voice.clear}>
              {t('agent.voice.clear', 'Clear')}
            </Button>
            <Button size="xs" onClick={voice.sendNow}>
              {t('agent.voice.sendNow', 'Send now')}
            </Button>
          </>
        )}
        {voice.locked && (
          <Button size="xs" variant="secondary" onClick={onStop}>
            <Square className="size-3.5" />
            {t('agent.composer.stop', 'Stop')}
          </Button>
        )}
      </div>
    </div>
  );
};
