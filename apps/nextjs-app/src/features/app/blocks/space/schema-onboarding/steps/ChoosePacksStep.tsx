import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import { PackCard } from '../components/PackCard';

export interface IChoosePacksStepProps {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  /** The pack whose details are open in the rail. */
  peek?: SchemaPackId | null;
  onToggle: (pack: SchemaPackId) => void;
  onPeek?: (pack: SchemaPackId) => void;
  onHover?: (pack: SchemaPackId | null) => void;
  /** Enter, once a pack is picked; the footer holds the button itself. */
  onContinue: () => void;
}

export const ChoosePacksStep = (props: IChoosePacksStepProps) => {
  const { catalog, packs, peek, onToggle, onPeek, onHover, onContinue } = props;
  const { t } = useTranslation('onboarding');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const index = Number(e.key) - 1;
      const pack = catalog.packs[index];
      if (pack && !e.metaKey && !e.ctrlKey && !e.altKey) onToggle(pack.id);
      if (e.key === 'Enter' && packs.length && target?.tagName !== 'BUTTON') onContinue();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catalog.packs, packs.length, onToggle, onContinue]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('choose.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('choose.subtitle')}</p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {catalog.packs.map((pack, index) => (
          <PackCard
            key={pack.id}
            id={pack.id}
            tables={pack.tables}
            index={index}
            selected={packs.includes(pack.id)}
            peeking={peek === pack.id}
            onToggle={() => onToggle(pack.id)}
            onPeek={() => onPeek?.(pack.id)}
            onHover={(hovering) => onHover?.(hovering ? pack.id : null)}
          />
        ))}
      </div>
    </div>
  );
};
