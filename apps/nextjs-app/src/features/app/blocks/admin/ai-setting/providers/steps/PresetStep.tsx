import { useTranslation } from 'next-i18next';
import { ProviderIcon } from '../../../../../components/ai/ProviderIcon';
import type { IProviderPreset } from '../presets';
import { PROVIDER_PRESETS } from '../presets';

/** Step 1 of "Add provider": pick a starting point. */
export const PresetStep = ({ onPick }: { onPick: (preset: IProviderPreset) => void }) => {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t(
          'admin.setting.ai.providers.presetHelp',
          'Pick a provider. "OpenAI-compatible" and "Anthropic-compatible" cover any other endpoint.'
        )}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDER_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onPick(preset)}
            className="flex items-center gap-2 rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`provider-preset-${preset.key}`}
          >
            <ProviderIcon type={preset.type} />
            <span className="truncate">{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
