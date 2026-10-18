import { SCHEMA_PACK_IDS } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { PACK_THEME } from '../packTheme';

export const WelcomeStep = ({ name, onStart }: { name: string; onStart: () => void }) => {
  const { t } = useTranslation('onboarding');
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 text-5xl duration-500 animate-in fade-in zoom-in-50 motion-reduce:animate-none">
        👋
      </div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t('welcome.title', { name })}
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">{t('welcome.subtitle')}</p>
      <p className="mt-6 max-w-lg text-sm text-muted-foreground">{t('welcome.body')}</p>
      <Button size="lg" className="mt-10 gap-2 px-8" onClick={onStart}>
        {t('welcome.start')}
        <ArrowRight className="size-4" />
      </Button>
      <div className="mt-12 flex gap-3" aria-hidden>
        {SCHEMA_PACK_IDS.map((id, i) => (
          <span
            key={id}
            className={cn(
              'size-2.5 rounded-full animate-in fade-in slide-in-from-bottom-3 fill-mode-both motion-reduce:animate-none',
              PACK_THEME[id].dot
            )}
            style={{ animationDelay: `${300 + i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
};
