import type { ISchemaPackCatalogVo, SchemaPackCurrency, SchemaPackId } from '@teable/openapi';
import { SCHEMA_PACK_CURRENCIES } from '@teable/openapi';
import {
  Button,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { PACK_THEME } from '../packTheme';
import type { IWizardState } from '../state';
import { CURRENCY_CODES } from '../state';

export interface IPersonaliseStepProps {
  catalog: ISchemaPackCatalogVo;
  state: IWizardState;
  /** Adding to an existing base: it keeps its own name and icon. */
  addingToBase?: boolean;
  onChange: (patch: Partial<IWizardState>) => void;
  onToggleOptional: (table: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

const timeZones = (current: string) => {
  const all =
    typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
      ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
          'timeZone'
        )
      : [];
  return all.includes(current) ? all : [current, ...all];
};

const Section = ({ children }: { children: React.ReactNode }) => (
  <section className="rounded-2xl border bg-card p-5">{children}</section>
);

const SectionTitle = ({ pack, children }: { pack?: SchemaPackId; children: React.ReactNode }) => (
  <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
    {pack && <span className={cn('size-2 rounded-full', PACK_THEME[pack].dot)} />}
    {children}
  </h2>
);

const Row = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <Label className="text-sm">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
    <div className="sm:w-64">{children}</div>
  </div>
);

export const PersonaliseStep = (props: IPersonaliseStepProps) => {
  const { catalog, state, addingToBase, onChange, onToggleOptional, onBack, onContinue } = props;
  const { t } = useTranslation('onboarding');
  const zones = useMemo(() => timeZones(state.timezone), [state.timezone]);
  const picked = catalog.packs.filter((p) => state.packs.includes(p.id));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('personalise.title')}</h1>

      <Section>
        <SectionTitle>{t('personalise.general')}</SectionTitle>
        {!addingToBase && (
          <Row label={t('personalise.baseName')}>
            <div className="flex gap-2">
              <Input
                aria-label={t('personalise.icon')}
                className="w-14 text-center"
                maxLength={4}
                value={state.icon}
                onChange={(e) => onChange({ icon: e.target.value })}
              />
              <Input
                aria-label={t('personalise.baseName')}
                value={state.baseName}
                maxLength={100}
                onChange={(e) => onChange({ baseName: e.target.value })}
              />
            </div>
          </Row>
        )}
        <Row label={t('personalise.timezone')} hint={t('personalise.timezoneHint')}>
          <Select value={state.timezone} onValueChange={(timezone) => onChange({ timezone })}>
            <SelectTrigger aria-label={t('personalise.timezone')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t('personalise.starterRows')} hint={t('personalise.starterRowsHint')}>
          <Switch
            aria-label={t('personalise.starterRows')}
            checked={state.starterRows}
            onCheckedChange={(starterRows) => onChange({ starterRows })}
          />
        </Row>
      </Section>

      {picked.map((pack) => {
        const optional = pack.tables.filter((tb) => tb.optional);
        if (!optional.length && pack.id !== 'finance') return null;
        return (
          <Section key={pack.id}>
            <SectionTitle pack={pack.id}>{t(`packs.${pack.id}.name`)}</SectionTitle>
            {pack.id === 'finance' && (
              <Row label={t('personalise.currency')}>
                <Select
                  value={state.currency}
                  onValueChange={(currency) =>
                    onChange({ currency: currency as SchemaPackCurrency })
                  }
                >
                  <SelectTrigger aria-label={t('personalise.currency')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} {SCHEMA_PACK_CURRENCIES[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            )}
            {optional.map((table) => (
              <Row
                key={table.key}
                label={t(`personalise.tables.${table.key}` as 'personalise.tables.auditlog')}
                hint={t(`personalise.tables.${table.key}Hint` as 'personalise.tables.auditlogHint')}
              >
                <Switch
                  aria-label={table.name}
                  checked={state.optionalTables.includes(table.key)}
                  onCheckedChange={() => onToggleOptional(table.key)}
                />
              </Row>
            ))}
          </Section>
        );
      })}

      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('back')}
        </Button>
        <Button onClick={onContinue} disabled={!addingToBase && !state.baseName.trim()}>
          {t('continue')}
        </Button>
      </div>
    </div>
  );
};
