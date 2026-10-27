import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
} from '@teable/ui-lib/shadcn';
import { ChevronsUpDown, Settings2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import {
  VoiceSelector,
  VoiceSelectorContent,
  VoiceSelectorDescription,
  VoiceSelectorEmpty,
  VoiceSelectorGroup,
  VoiceSelectorInput,
  VoiceSelectorItem,
  VoiceSelectorList,
  VoiceSelectorName,
  VoiceSelectorPreview,
} from '@/components/ai-elements/voice-selector';
import { isGoogleVoice, pickVoice } from './engines/browser-engine';
import type { IEngineChoice } from './speech-queue';
import type { IVoiceConversation } from './useVoiceConversation';
import { useAgentVoiceStore } from './voice-store';

const ENGINES: IEngineChoice[] = ['auto', 'elevenlabs', 'browser'];
const baseLang = (lang: string) => lang.toLowerCase().split(/[-_]/)[0];

/** The browser's voices: the admin's language first, then online (Google, Microsoft) apart. */
const VoicePicker = ({
  open,
  onOpenChange,
  voices,
  lang,
  value,
  onChange,
  onPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voices: SpeechSynthesisVoice[];
  lang: string;
  value?: string;
  onChange: (voiceURI: string) => void;
  onPreview: (voice: SpeechSynthesisVoice) => void;
}) => {
  const { t } = useTranslation('common');
  const groups = useMemo(() => {
    const mine = (v: SpeechSynthesisVoice) => (baseLang(v.lang) === baseLang(lang) ? 0 : 1);
    const sorted = [...voices].sort(
      (a, b) =>
        mine(a) - mine(b) ||
        Number(isGoogleVoice(b)) - Number(isGoogleVoice(a)) ||
        a.name.localeCompare(b.name)
    );
    return [
      {
        key: 'online',
        heading: t('agent.voice.settings.online', 'Online (Google / Microsoft)'),
        voices: sorted.filter((v) => !v.localService),
      },
      {
        key: 'device',
        heading: t('agent.voice.settings.device', 'This device'),
        voices: sorted.filter((v) => v.localService),
      },
    ].filter((g) => g.voices.length);
  }, [voices, lang, t]);

  return (
    <VoiceSelector open={open} onOpenChange={onOpenChange} value={value}>
      <VoiceSelectorContent title={t('agent.voice.settings.choose', 'Choose a voice')}>
        <VoiceSelectorInput placeholder={t('agent.voice.settings.search', 'Search voices')} />
        <VoiceSelectorList>
          <VoiceSelectorEmpty>
            {t('agent.voice.settings.noMatch', 'No voices found')}
          </VoiceSelectorEmpty>
          {groups.map((group) => (
            <VoiceSelectorGroup key={group.key} heading={group.heading}>
              {group.voices.map((v) => (
                <VoiceSelectorItem
                  key={v.voiceURI}
                  value={`${v.name} ${v.lang} ${v.voiceURI}`}
                  onSelect={() => onChange(v.voiceURI)}
                >
                  <VoiceSelectorName>{v.name}</VoiceSelectorName>
                  <VoiceSelectorDescription>{v.lang}</VoiceSelectorDescription>
                  <VoiceSelectorPreview onPlay={() => onPreview(v)} />
                </VoiceSelectorItem>
              ))}
            </VoiceSelectorGroup>
          ))}
        </VoiceSelectorList>
      </VoiceSelectorContent>
    </VoiceSelector>
  );
};

/**
 * Who speaks the replies, and which browser voice (voice design §8). Kept per browser; disabled
 * while the agent responds, so the engine never changes mid-reply.
 */
export const VoiceSettings = ({ voice }: { voice: IVoiceConversation }) => {
  const { t } = useTranslation('common');
  const engine = useAgentVoiceStore((s) => s.engine);
  const setEngine = useAgentVoiceStore((s) => s.setEngine);
  const voiceURI = useAgentVoiceStore((s) => s.browserVoiceURI);
  const setBrowserVoice = useAgentVoiceStore((s) => s.setBrowserVoice);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const { browserVoices } = voice;

  useEffect(() => {
    if (open) void browserVoices().then(setVoices);
  }, [open, browserVoices]);

  const current = pickVoice(voices, voice.lang, voiceURI);
  const labels: Record<IEngineChoice, string> = {
    auto: t('agent.voice.settings.auto', 'Auto (ElevenLabs, else browser)'),
    elevenlabs: t('agent.voice.settings.elevenlabs', 'ElevenLabs'),
    browser: t('agent.voice.settings.browser', 'Browser voice'),
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={voice.locked}
            title={t('agent.voice.settings.title', 'Voice settings')}
            aria-label={t('agent.voice.settings.title', 'Voice settings')}
          >
            <Settings2 className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3 text-sm">
          <div className="space-y-2">
            <div className="font-medium">
              {t('agent.voice.settings.speakWith', 'Speak replies with')}
            </div>
            <RadioGroup value={engine} onValueChange={(v) => setEngine(v as IEngineChoice)}>
              {ENGINES.map((choice) => (
                <div key={choice} className="flex items-center gap-2">
                  <RadioGroupItem id={`agent-voice-engine-${choice}`} value={choice} />
                  <Label htmlFor={`agent-voice-engine-${choice}`} className="font-normal">
                    {labels[choice]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              {t('agent.voice.settings.browserVoice', 'Browser voice')}
            </div>
            {current ? (
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  className="min-w-0 flex-1 justify-between"
                  onClick={() => setPickerOpen(true)}
                >
                  <span className="truncate">{current.name}</span>
                  <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
                </Button>
                <VoiceSelectorPreview onPlay={() => voice.previewVoice(current)} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('agent.voice.settings.noVoices', 'This browser has no voices')}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <VoicePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        voices={voices}
        lang={voice.lang}
        value={current?.voiceURI}
        onPreview={voice.previewVoice}
        onChange={(uri) => {
          setBrowserVoice(uri);
          setPickerOpen(false);
        }}
      />
    </>
  );
};
