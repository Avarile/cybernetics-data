import type { SchemaPackCurrency, SchemaPackId } from '@teable/openapi';
import { SCHEMA_PACK_CURRENCIES, SCHEMA_PACK_IDS } from '@teable/openapi';

export type WizardStep = 'welcome' | 'choose' | 'personalise' | 'review' | 'building' | 'ready';

export interface IWizardState {
  step: WizardStep;
  packs: SchemaPackId[];
  optionalTables: string[];
  baseName: string;
  icon: string;
  timezone: string;
  currency: SchemaPackCurrency;
  starterRows: boolean;
}

export type WizardAction =
  | { type: 'goto'; step: WizardStep }
  | { type: 'togglePack'; pack: SchemaPackId; optionalOf: (pack: SchemaPackId) => string[] }
  | { type: 'selectAll'; optionalOf: (pack: SchemaPackId) => string[] }
  | { type: 'toggleOptional'; table: string }
  | { type: 'set'; patch: Partial<Omit<IWizardState, 'step' | 'packs' | 'optionalTables'>> };

/** Optional tables that start switched on when their pack is picked. */
export const OPTIONAL_ON_BY_DEFAULT = ['project_frameworks', 'finance_Budgets', 'finance_Tags'];

const REGION_CURRENCY: Record<string, SchemaPackCurrency> = {
  AU: 'AUD',
  US: 'USD',
  CA: 'CAD',
  NZ: 'NZD',
  SG: 'SGD',
  HK: 'HKD',
  GB: 'GBP',
  CN: 'CNY',
  JP: 'JPY',
  IN: 'INR',
  CH: 'CHF',
};
const EURO_REGIONS = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
]);
const LANGUAGE_CURRENCY: Record<string, SchemaPackCurrency> = {
  de: 'EUR',
  fr: 'EUR',
  es: 'EUR',
  it: 'EUR',
  nl: 'EUR',
  pt: 'EUR',
  fi: 'EUR',
  el: 'EUR',
  ja: 'JPY',
  zh: 'CNY',
};

/** `en-AU` → AUD, `de-DE` → EUR, `ja` → JPY, `pt-BR` → USD; the region wins over the language. */
export const guessCurrency = (locale: string): SchemaPackCurrency => {
  const [language, rawRegion] = locale.split(/[-_]/);
  const region = rawRegion?.toUpperCase();
  if (region) {
    if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    return EURO_REGIONS.has(region) ? 'EUR' : 'USD';
  }
  return LANGUAGE_CURRENCY[language?.toLowerCase()] ?? 'USD';
};

export const createInitialState = (
  overrides: Partial<IWizardState> & { baseName: string }
): IWizardState => {
  const locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language;
  const timezone =
    typeof Intl === 'undefined' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    step: 'welcome',
    packs: [],
    optionalTables: [],
    icon: '🧭',
    timezone: timezone || 'UTC',
    currency: guessCurrency(locale),
    starterRows: true,
    ...overrides,
  };
};

const ordered = (packs: SchemaPackId[]) => SCHEMA_PACK_IDS.filter((id) => packs.includes(id));

export const wizardReducer = (state: IWizardState, action: WizardAction): IWizardState => {
  switch (action.type) {
    case 'goto':
      return { ...state, step: action.step };
    case 'togglePack': {
      const optional = action.optionalOf(action.pack);
      if (state.packs.includes(action.pack)) {
        return {
          ...state,
          packs: state.packs.filter((p) => p !== action.pack),
          optionalTables: state.optionalTables.filter((t) => !optional.includes(t)),
        };
      }
      return {
        ...state,
        packs: ordered([...state.packs, action.pack]),
        optionalTables: [
          ...state.optionalTables,
          ...optional.filter((t) => OPTIONAL_ON_BY_DEFAULT.includes(t)),
        ],
      };
    }
    case 'selectAll': {
      const added = SCHEMA_PACK_IDS.filter((id) => !state.packs.includes(id));
      return {
        ...state,
        packs: [...SCHEMA_PACK_IDS],
        optionalTables: [
          ...state.optionalTables,
          ...added.flatMap(action.optionalOf).filter((t) => OPTIONAL_ON_BY_DEFAULT.includes(t)),
        ],
      };
    }
    case 'toggleOptional':
      return {
        ...state,
        optionalTables: state.optionalTables.includes(action.table)
          ? state.optionalTables.filter((t) => t !== action.table)
          : [...state.optionalTables, action.table],
      };
    case 'set':
      return { ...state, ...action.patch };
  }
};

export const CURRENCY_CODES = Object.keys(SCHEMA_PACK_CURRENCIES) as SchemaPackCurrency[];
