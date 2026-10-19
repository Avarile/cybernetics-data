import type { ISchemaPackCatalogVo, SchemaPackCurrency, SchemaPackId } from '@teable/openapi';
import { SCHEMA_PACK_CURRENCIES } from '@teable/openapi';
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@teable/ui-lib/shadcn';
import { Check, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { EmojiPicker } from '../../../../components/emoji/EmojiPicker';
import { PACK_THEME } from '../packTheme';
import type { IWizardState } from '../state';
import { CURRENCY_CODES } from '../state';

export interface IBuildOptionsProps {
  catalog: ISchemaPackCatalogVo;
  state: IWizardState;
  /** Adding to an existing base: it keeps its own name and icon. */
  addingToBase?: boolean;
  onChange: (patch: Partial<IWizardState>) => void;
  onToggleOptional: (table: string) => void;
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

const zoneLabel = (zone: string) => zone.replace(/_/g, ' ');

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

/** About 400 zones: a searchable list, not a plain select. */
const TimezonePicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { t } = useTranslation('onboarding');
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => timeZones(value), [value]);
  return (
    // Modal so the list scrolls with the wheel inside the wizard's dialog.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t('personalise.timezone')}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{zoneLabel(value)}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="end">
        <Command>
          <CommandInput placeholder={t('personalise.timezoneSearch')} />
          <CommandList className="max-h-64">
            <CommandEmpty>{t('personalise.timezoneEmpty')}</CommandEmpty>
            {zones.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                onSelect={() => {
                  onChange(zone);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn('mr-2 size-4', zone === value ? 'opacity-100' : 'opacity-0')}
                />
                {zoneLabel(zone)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const ExtraTableTile = (props: {
  pack: SchemaPackId;
  table: { key: string; name: string; icon?: string };
  on: boolean;
  onToggle: () => void;
}) => {
  const { pack, table, on, onToggle } = props;
  const { t } = useTranslation('onboarding');
  const theme = PACK_THEME[pack];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={table.name}
      onClick={onToggle}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-foreground/25 motion-reduce:transition-none',
        on && cn(theme.selected, 'ring-1')
      )}
    >
      <span aria-hidden className="text-lg leading-none">
        {table.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {t(`personalise.tables.${table.key}` as 'personalise.tables.auditlog')}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t(`personalise.tables.${table.key}Hint` as 'personalise.tables.auditlogHint')}
        </span>
      </span>
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
          on ? cn(theme.dot, 'border-transparent text-white') : 'border-muted-foreground/30'
        )}
      >
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
};

/**
 * Everything that used to be its own Personalise step. The name of a new base stays in view;
 * the rest has good defaults, so it sits folded behind a one-line summary.
 */
export const BuildOptions = (props: IBuildOptionsProps) => {
  const { catalog, state, addingToBase, onChange, onToggleOptional } = props;
  const { t } = useTranslation('onboarding');
  const [open, setOpen] = useState(false);
  const picked = catalog.packs.filter((p) => state.packs.includes(p.id));
  const extras = picked.flatMap((p) =>
    p.tables.filter((tb) => tb.optional).map((table) => ({ pack: p.id, table }))
  );
  const extrasOn = extras.filter((e) => state.optionalTables.includes(e.table.key)).length;
  const hasFinance = state.packs.includes('finance');

  const summary = [
    zoneLabel(state.timezone),
    hasFinance && state.currency,
    state.starterRows && t('personalise.starterRows'),
    extras.length > 0 && t('review.extraTables', { count: extrasOn }),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      {!addingToBase && (
        <div className="flex gap-2">
          <EmojiPicker modal onChange={(icon) => onChange({ icon })}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0 text-lg"
              aria-label={t('personalise.icon')}
            >
              {state.icon || '🧭'}
            </Button>
          </EmojiPicker>
          <Input
            aria-label={t('personalise.baseName')}
            placeholder={t('personalise.baseName')}
            className="h-10 text-base font-medium"
            value={state.baseName}
            maxLength={100}
            onChange={(e) => onChange({ baseName: e.target.value })}
          />
        </div>
      )}

      <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border bg-card">
        <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-muted/50">
          <span className="text-sm font-medium">{t('review.options')}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {summary.join(' · ')}
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              open && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-4 pb-4 pt-2">
          <Row label={t('personalise.timezone')} hint={t('personalise.timezoneHint')}>
            <TimezonePicker
              value={state.timezone}
              onChange={(timezone) => onChange({ timezone })}
            />
          </Row>
          {hasFinance && (
            <Row label={t('personalise.currency')}>
              <Select
                value={state.currency}
                onValueChange={(currency) => onChange({ currency: currency as SchemaPackCurrency })}
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
          <Row label={t('personalise.starterRows')} hint={t('personalise.starterRowsHint')}>
            <div className="flex sm:justify-end">
              <Switch
                aria-label={t('personalise.starterRows')}
                checked={state.starterRows}
                onCheckedChange={(starterRows) => onChange({ starterRows })}
              />
            </div>
          </Row>
          {extras.length > 0 && (
            <div className="pt-3">
              <Label className="text-sm">{t('personalise.extraTables')}</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {extras.map(({ pack, table }) => (
                  <ExtraTableTile
                    key={table.key}
                    pack={pack}
                    table={table}
                    on={state.optionalTables.includes(table.key)}
                    onToggle={() => onToggleOptional(table.key)}
                  />
                ))}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
