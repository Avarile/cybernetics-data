import { LLMProviderType, MODEL_LISTING_TYPES } from '@teable/openapi';
import axios from 'axios';

/** What a connection test needs: everything resolved (key decrypted, env refs read). */
export interface IProbeTarget {
  type: LLMProviderType;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface IProbeResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  models?: string[];
  error?: string;
  hint?: string;
}

const probeTimeoutMs = 10_000;

/** Endpoints used when a provider of a well-known type has no base URL. */
const defaultBaseUrls: Partial<Record<LLMProviderType, string>> = {
  [LLMProviderType.OPENAI]: 'https://api.openai.com/v1',
  [LLMProviderType.OPENROUTER]: 'https://openrouter.ai/api/v1',
  [LLMProviderType.DEEPSEEK]: 'https://api.deepseek.com/v1',
  [LLMProviderType.XAI]: 'https://api.x.ai/v1',
  [LLMProviderType.MISTRAL]: 'https://api.mistral.ai/v1',
  [LLMProviderType.TOGETHERAI]: 'https://api.together.xyz/v1',
  [LLMProviderType.ANTHROPIC]: 'https://api.anthropic.com/v1',
  [LLMProviderType.OLLAMA]: 'http://localhost:11434',
};

export const canListModels = (type: LLMProviderType) => MODEL_LISTING_TYPES.includes(type);

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** The request that lists models for this provider type. */
export function modelListRequest(target: IProbeTarget): {
  url: string;
  headers: Record<string, string>;
  pick: (body: unknown) => string[];
} {
  const base = trimSlash(target.baseUrl || defaultBaseUrls[target.type] || '');
  const extra = target.headers ?? {};
  if (target.type === LLMProviderType.OLLAMA) {
    // Ollama's native listing; the AI SDK provider is configured with either host or host/api.
    return {
      url: `${base.replace(/\/api$/, '')}/api/tags`,
      headers: extra,
      pick: (body) =>
        ((body as { models?: { name?: string }[] })?.models ?? [])
          .map((m) => m.name)
          .filter((n): n is string => Boolean(n)),
    };
  }
  const isAnthropic =
    target.type === LLMProviderType.ANTHROPIC ||
    target.type === LLMProviderType.ANTHROPIC_COMPATIBLE;
  const auth: Record<string, string> = {};
  if (target.apiKey && isAnthropic) {
    auth['x-api-key'] = target.apiKey;
    auth['anthropic-version'] = '2023-06-01';
  } else if (target.apiKey) {
    auth.Authorization = `Bearer ${target.apiKey}`;
  }
  return {
    url: `${base}/models`,
    headers: { ...extra, ...auth },
    pick: (body) =>
      ((body as { data?: { id?: string }[] })?.data ?? [])
        .map((m) => m.id)
        .filter((n): n is string => Boolean(n)),
  };
}

/** A short, actionable hint for common connection failures. */
export function probeHint(error: { status?: number; code?: string }, target: IProbeTarget) {
  const { status, code } = error;
  if (status === 401 || status === 403) return 'The provider rejected the API key.';
  if (status === 404 && target.baseUrl && !/\/v\d+\/?$/.test(target.baseUrl)) {
    return 'Not found. OpenAI-compatible base URLs usually end with /v1.';
  }
  if (code === 'ECONNREFUSED') {
    return 'Nothing is listening there. From Docker or k3s, use host.docker.internal or the service name instead of localhost.';
  }
  if (code === 'ENOTFOUND') return 'The host name does not resolve.';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'The request timed out.';
  return undefined;
}

/** List models from the provider's endpoint. Never throws; failures come back as `ok: false`. */
export async function probeModels(target: IProbeTarget): Promise<IProbeResult> {
  const started = Date.now();
  const request = modelListRequest(target);
  if (!/^https?:\/\//.test(request.url)) {
    return { ok: false, latencyMs: 0, error: 'A base URL is required for this provider type.' };
  }
  try {
    const res = await axios.get(request.url, {
      headers: request.headers,
      timeout: probeTimeoutMs,
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, latencyMs, models: request.pick(res.data) };
    }
    return {
      ok: false,
      status: res.status,
      latencyMs,
      error: `HTTP ${res.status}`,
      hint: probeHint({ status: res.status }, target),
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err.message ?? 'Request failed',
      hint: probeHint({ code: err.code }, target),
    };
  }
}
