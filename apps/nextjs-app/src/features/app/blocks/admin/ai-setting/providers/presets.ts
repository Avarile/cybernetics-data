import { LLMProviderType } from '@teable/openapi';

/** A starting point in the "Add provider" sheet: fills type, base URL, id and hints. */
export interface IProviderPreset {
  key: string;
  type: LLMProviderType;
  label: string;
  /** Suggested provider id (the admin can change it before saving). */
  idHint: string;
  baseUrl?: string;
  /** Whether the base URL must be typed (custom and self-hosted endpoints). */
  baseUrlRequired?: boolean;
  /** Header names worth suggesting, with example values. */
  headerHints?: Record<string, string>;
  fetchModels?: boolean;
  /** Can run without a key (local or self-hosted). */
  keyless?: boolean;
  docsUrl?: string;
  /** Shown first in the empty state. */
  quick?: boolean;
}

export const PROVIDER_PRESETS: IProviderPreset[] = [
  {
    key: 'openrouter',
    type: LLMProviderType.OPENROUTER,
    label: 'OpenRouter',
    idHint: 'openrouter',
    headerHints: { 'HTTP-Referer': 'https://your-app.example', 'X-Title': 'Cybernetics' },
    fetchModels: true,
    docsUrl: 'https://openrouter.ai/keys',
    quick: true,
  },
  {
    key: 'ollama',
    type: LLMProviderType.OPENAI_COMPATIBLE,
    label: 'Ollama',
    idHint: 'ollama-local',
    baseUrl: 'http://host.docker.internal:11434/v1',
    baseUrlRequired: true,
    fetchModels: true,
    keyless: true,
    quick: true,
  },
  {
    key: 'openai-compatible',
    type: LLMProviderType.OPENAI_COMPATIBLE,
    label: 'OpenAI-compatible',
    idHint: 'custom',
    baseUrlRequired: true,
    fetchModels: true,
    keyless: true,
    quick: true,
  },
  {
    key: 'openai',
    type: LLMProviderType.OPENAI,
    label: 'OpenAI',
    idHint: 'openai',
    fetchModels: true,
  },
  {
    key: 'anthropic',
    type: LLMProviderType.ANTHROPIC,
    label: 'Anthropic',
    idHint: 'anthropic',
    fetchModels: true,
  },
  { key: 'google', type: LLMProviderType.GOOGLE, label: 'Google', idHint: 'google' },
  {
    key: 'azure',
    type: LLMProviderType.AZURE,
    label: 'Azure OpenAI',
    idHint: 'azure',
    baseUrlRequired: true,
  },
  {
    key: 'bedrock',
    type: LLMProviderType.AMAZONBEDROCK,
    label: 'Amazon Bedrock',
    idHint: 'bedrock',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
  },
  {
    key: 'deepseek',
    type: LLMProviderType.DEEPSEEK,
    label: 'DeepSeek',
    idHint: 'deepseek',
    fetchModels: true,
  },
  { key: 'xai', type: LLMProviderType.XAI, label: 'xAI', idHint: 'xai', fetchModels: true },
  {
    key: 'mistral',
    type: LLMProviderType.MISTRAL,
    label: 'Mistral',
    idHint: 'mistral',
    fetchModels: true,
  },
  {
    key: 'vercel-gateway',
    type: LLMProviderType.AI_GATEWAY,
    label: 'Vercel AI Gateway',
    idHint: 'vercel-gateway',
    docsUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys',
  },
  {
    key: 'lm-studio',
    type: LLMProviderType.OPENAI_COMPATIBLE,
    label: 'LM Studio',
    idHint: 'lm-studio',
    baseUrl: 'http://host.docker.internal:1234/v1',
    baseUrlRequired: true,
    fetchModels: true,
    keyless: true,
  },
  {
    key: 'vllm',
    type: LLMProviderType.OPENAI_COMPATIBLE,
    label: 'vLLM',
    idHint: 'vllm',
    baseUrl: 'http://<host>:8000/v1',
    baseUrlRequired: true,
    fetchModels: true,
    keyless: true,
  },
  {
    key: 'litellm',
    type: LLMProviderType.OPENAI_COMPATIBLE,
    label: 'LiteLLM',
    idHint: 'litellm',
    baseUrl: 'http://<host>:4000/v1',
    baseUrlRequired: true,
    fetchModels: true,
  },
  {
    key: 'anthropic-compatible',
    type: LLMProviderType.ANTHROPIC_COMPATIBLE,
    label: 'Anthropic-compatible',
    idHint: 'anthropic-proxy',
    baseUrlRequired: true,
    fetchModels: true,
  },
];

/** Provider types that may run without a key. */
export const KEYLESS_TYPES: LLMProviderType[] = [
  LLMProviderType.OLLAMA,
  LLMProviderType.OPENAI_COMPATIBLE,
];

/** Types whose base URL has no sensible default. */
export const BASE_URL_REQUIRED_TYPES: LLMProviderType[] = [
  LLMProviderType.OPENAI_COMPATIBLE,
  LLMProviderType.ANTHROPIC_COMPATIBLE,
  LLMProviderType.AZURE,
];

export const findPreset = (key: string) => PROVIDER_PRESETS.find((p) => p.key === key);
