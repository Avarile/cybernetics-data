import type {
  IAiProviderVo,
  ICreateAiProviderRo,
  IModelConfig,
  IUpdateAiProviderRo,
  LLMProviderType,
} from '@teable/openapi';
import { checkProviderEnvName, isProviderIdAllowed, suggestProviderId } from '@teable/openapi';
import type { IProviderPreset } from './presets';
import { BASE_URL_REQUIRED_TYPES, KEYLESS_TYPES } from './presets';

/**
 * Where the key comes from in the sheet: keep the stored one (editing only), paste a new one,
 * read it from an env var, or none.
 */
export type IKeyMode = 'stored' | 'paste' | 'env' | 'none';

export interface IHeaderRow {
  name: string;
  value: string;
}

/** Everything the provider sheet edits. Pure data, so it is easy to test. */
export interface IProviderFormState {
  id: string;
  /** False until the admin edits the id; until then it follows the name. */
  idTouched: boolean;
  name: string;
  type: LLMProviderType;
  baseUrl: string;
  keyMode: IKeyMode;
  apiKey: string;
  apiKeyEnv: string;
  headers: IHeaderRow[];
  /** Models the provider exposes (checked in the Models step). */
  models: string[];
  fetchModels: boolean;
  modelConfigs: Record<string, IModelConfig>;
  enabled: boolean;
}

export type IProviderFormErrors = Partial<
  Record<'id' | 'name' | 'baseUrl' | 'key' | 'headers', string>
>;

const splitModels = (models: string | undefined) =>
  (models ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

export function stateFromPreset(
  preset: IProviderPreset,
  takenIds: string[] = []
): IProviderFormState {
  let id = preset.idHint;
  for (let n = 2; takenIds.includes(id); n++) id = `${preset.idHint}-${n}`;
  return {
    id,
    idTouched: false,
    name: preset.label,
    type: preset.type,
    baseUrl: preset.baseUrl ?? '',
    keyMode: preset.keyless ? 'none' : 'paste',
    apiKey: '',
    apiKeyEnv: '',
    headers: [],
    models: [],
    fetchModels: Boolean(preset.fetchModels),
    modelConfigs: {},
    enabled: true,
  };
}

export function stateFromProvider(vo: IAiProviderVo): IProviderFormState {
  return {
    id: vo.id,
    idTouched: true,
    name: vo.name,
    type: vo.type,
    baseUrl: vo.baseUrl ?? '',
    keyMode: vo.keySource === 'stored' ? 'stored' : vo.keySource === 'env' ? 'env' : 'none',
    apiKey: '',
    apiKeyEnv: vo.apiKeyEnv ?? '',
    headers: Object.entries(vo.headers ?? {}).map(([name, value]) => ({ name, value })),
    models: splitModels(vo.models),
    fetchModels: Boolean(vo.fetchModels),
    modelConfigs: vo.modelConfigs ?? {},
    enabled: vo.enabled !== false,
  };
}

/** Duplicate: same settings, new id, no key (keys are never copied). */
export function duplicateState(vo: IAiProviderVo, takenIds: string[]): IProviderFormState {
  const base = stateFromProvider(vo);
  let id = `${vo.id}-copy`;
  for (let n = 2; takenIds.includes(id); n++) id = `${vo.id}-copy-${n}`;
  return {
    ...base,
    id,
    idTouched: false,
    name: `${vo.name} (copy)`,
    keyMode: base.keyMode === 'env' ? 'env' : 'paste',
  };
}

/** Renaming follows into the id until the admin edits the id or the provider is saved. */
export function withName(state: IProviderFormState, name: string): IProviderFormState {
  return state.idTouched ? { ...state, name } : { ...state, name, id: suggestProviderId(name) };
}

const headersRecord = (rows: IHeaderRow[]) =>
  Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]));

const idError = (state: IProviderFormState, takenIds: string[]) => {
  if (!isProviderIdAllowed(state.id)) return 'invalid';
  return takenIds.includes(state.id) ? 'taken' : undefined;
};

const baseUrlError = (state: IProviderFormState) => {
  const url = state.baseUrl.trim();
  if (!url) return BASE_URL_REQUIRED_TYPES.includes(state.type) ? 'required' : undefined;
  return /^https?:\/\/[^\s<>]+$/.test(url) ? undefined : 'invalid';
};

const keyError = (state: IProviderFormState, envPattern = '.*') => {
  const keyless = KEYLESS_TYPES.includes(state.type);
  if (state.keyMode === 'paste') return !state.apiKey.trim() && !keyless ? 'required' : undefined;
  // The browser checks syntax and the denylist; the server also applies its allow pattern.
  if (state.keyMode === 'env')
    return checkProviderEnvName(state.apiKeyEnv, envPattern).ok ? undefined : 'env';
  if (state.keyMode === 'none') return keyless ? undefined : 'required';
  return undefined;
};

export function validateState(
  state: IProviderFormState,
  opts: { creating: boolean; takenIds: string[]; envPattern?: string }
): IProviderFormErrors {
  const names = state.headers.map((h) => h.name.trim().toLowerCase()).filter(Boolean);
  const errors: IProviderFormErrors = {
    id: opts.creating ? idError(state, opts.takenIds) : undefined,
    name: state.name.trim() ? undefined : 'required',
    baseUrl: baseUrlError(state),
    key: keyError(state, opts.envPattern),
    headers: new Set(names).size === names.length ? undefined : 'duplicate',
  };
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as IProviderFormErrors;
}

export function toCreateRo(state: IProviderFormState): ICreateAiProviderRo {
  return {
    id: state.id,
    type: state.type,
    name: state.name.trim(),
    models: state.models.join(','),
    ...(state.baseUrl.trim() ? { baseUrl: state.baseUrl.trim() } : {}),
    ...(state.keyMode === 'paste' && state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}),
    ...(state.keyMode === 'env' ? { apiKeyEnv: state.apiKeyEnv } : {}),
    ...(state.headers.some((h) => h.name.trim()) ? { headers: headersRecord(state.headers) } : {}),
    fetchModels: state.fetchModels,
    enabled: state.enabled,
    ...(Object.keys(state.modelConfigs).length ? { modelConfigs: state.modelConfigs } : {}),
  };
}

/** Key-source changes: the stored key is never re-sent; switching sources clears the old one. */
function keyChanges(
  state: IProviderFormState,
  original: IAiProviderVo
): Partial<IUpdateAiProviderRo> {
  const clearKey = original.hasApiKey ? { apiKey: null } : {};
  const clearEnv = original.apiKeyEnv ? { apiKeyEnv: null } : {};
  switch (state.keyMode) {
    case 'paste':
      return { ...clearEnv, ...(state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}) };
    case 'env':
      return {
        ...clearKey,
        ...(state.apiKeyEnv !== original.apiKeyEnv ? { apiKeyEnv: state.apiKeyEnv } : {}),
      };
    case 'none':
      return { ...clearKey, ...clearEnv };
    default:
      return {};
  }
}

const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/** Only what changed is sent; the key is never re-sent unless the admin typed a new one. */
export function toUpdateRo(
  state: IProviderFormState,
  original: IAiProviderVo
): IUpdateAiProviderRo {
  const name = state.name.trim();
  const baseUrl = state.baseUrl.trim();
  const models = state.models.join(',');
  const headers = headersRecord(state.headers);
  return {
    version: original.version,
    ...(name !== original.name ? { name } : {}),
    ...(state.type !== original.type ? { type: state.type } : {}),
    ...(baseUrl !== (original.baseUrl ?? '') ? { baseUrl: baseUrl || null } : {}),
    ...(models !== (original.models ?? '') ? { models } : {}),
    ...(state.fetchModels !== Boolean(original.fetchModels)
      ? { fetchModels: state.fetchModels }
      : {}),
    ...(state.enabled !== (original.enabled !== false) ? { enabled: state.enabled } : {}),
    ...(changed(headers, original.headers ?? {}) ? { headers } : {}),
    ...(changed(state.modelConfigs, original.modelConfigs ?? {})
      ? { modelConfigs: state.modelConfigs }
      : {}),
    ...keyChanges(state, original),
  };
}

/** The draft sent to "Test connection": only what is needed to call the endpoint. */
export function toTestDraft(state: IProviderFormState) {
  return {
    type: state.type,
    ...(state.baseUrl.trim() ? { baseUrl: state.baseUrl.trim() } : {}),
    ...(state.keyMode === 'paste' && state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}),
    ...(state.keyMode === 'env' && state.apiKeyEnv ? { apiKeyEnv: state.apiKeyEnv } : {}),
    ...(state.headers.some((h) => h.name.trim()) ? { headers: headersRecord(state.headers) } : {}),
    ...(state.models.length ? { models: state.models.join(',') } : {}),
  };
}

export const hasErrors = (errors: IProviderFormErrors) => Object.keys(errors).length > 0;
