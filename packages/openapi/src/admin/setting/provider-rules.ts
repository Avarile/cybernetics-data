/**
 * Rules for LLM provider ids, env-var key references and custom headers. Shared by the backend
 * (which enforces them) and the admin UI (which validates as the admin types).
 */

/** Stable provider id: lowercase slug, used in model keys (`type@model@<id>`). */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** `teable` is the legacy alias for instance providers, so no provider may take it as its id. */
export const RESERVED_PROVIDER_IDS = ['teable'];

/** Syntax every env-var name must have before any other rule is checked. */
export const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Env vars a provider may read its key from, unless the server sets AI_PROVIDER_ENV_PATTERN.
 * Without this rule an admin session could send any server secret to any base URL as a "key".
 */
export const DEFAULT_PROVIDER_ENV_PATTERN =
  '^(LLM|AI|OPENAI|ANTHROPIC|GOOGLE|AZURE|AWS|GROQ|MISTRAL|OPENROUTER|DEEPSEEK|XAI|OLLAMA|VLLM|LITELLM|TOGETHER|COHERE)_[A-Z0-9_]+$';

/** The app's own secrets: never readable as a provider key, whatever the pattern allows. */
export const PROVIDER_ENV_DENYLIST: RegExp[] = [
  /^SECRET_KEY$/,
  /^SECRETS_ENCRYPTION_KEY$/,
  /^BACKEND_/,
  /^PRISMA_/,
  /DATABASE_URL$/,
  /^MASTRA_/,
  /^REDIS/,
  /JWT/,
  /SESSION/,
];

/** Prefix that marks a header value as an env-var reference: `env:OPENROUTER_REFERER`. */
export const ENV_REF_PREFIX = 'env:';

/** Header names allowed on a provider: plain tokens, none of the hop-by-hop or framing headers. */
export const HEADER_NAME_PATTERN = /^[a-z0-9-]{1,64}$/i;
export const FORBIDDEN_HEADER_NAMES = [
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'cookie',
];
export const MAX_HEADER_VALUE_LENGTH = 2048;
export const MAX_PROVIDER_HEADERS = 20;

export type IProviderEnvCheck =
  | { ok: true }
  | { ok: false; reason: 'syntax' | 'denied' | 'not-allowed' };

/** Whether a provider may read its key (or a header value) from env var `name`. */
export function checkProviderEnvName(
  name: string,
  pattern: string = DEFAULT_PROVIDER_ENV_PATTERN
): IProviderEnvCheck {
  if (!ENV_NAME_PATTERN.test(name)) return { ok: false, reason: 'syntax' };
  if (PROVIDER_ENV_DENYLIST.some((re) => re.test(name))) return { ok: false, reason: 'denied' };
  if (!new RegExp(pattern).test(name)) return { ok: false, reason: 'not-allowed' };
  return { ok: true };
}

/** The env-var name in an `env:VAR` header value, or undefined for a literal value. */
export function parseEnvRef(value: string): string | undefined {
  return value.startsWith(ENV_REF_PREFIX) ? value.slice(ENV_REF_PREFIX.length) : undefined;
}

export function isProviderIdAllowed(id: string): boolean {
  return PROVIDER_ID_PATTERN.test(id) && !RESERVED_PROVIDER_IDS.includes(id);
}

/** A slug suggestion from a display name: "vLLM (gpu-01)" -> "vllm-gpu-01". */
export function suggestProviderId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!slug) return 'provider';
  return RESERVED_PROVIDER_IDS.includes(slug) ? `${slug}-1` : slug;
}

/** Display names per provider type, for providers saved without one. Keys are LLMProviderType values. */
export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  azure: 'Azure OpenAI',
  cohere: 'Cohere',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  zhipu: 'Zhipu',
  lingyiwanwu: 'Lingyiwanwu',
  xai: 'xAI',
  togetherai: 'Together AI',
  ollama: 'Ollama',
  amazonBedrock: 'Amazon Bedrock',
  openRouter: 'OpenRouter',
  openaiCompatible: 'OpenAI-compatible',
  anthropicCompatible: 'Anthropic-compatible',
  aiGateway: 'Vercel AI Gateway',
  claudeCode: 'Claude Code',
};

export const providerTypeLabel = (type: string) => PROVIDER_TYPE_LABELS[type] ?? type;
