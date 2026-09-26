import type { IBaseGraphQueryRo } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useCallback, useMemo } from 'react';
import { decodeQuery, encodeQuery, MAX_ENCODED_QUERY_LENGTH } from '../utils/queryCodec';

export interface IGraphUrlState {
  /** The validated query in the URL, or null when absent/invalid. */
  ro: IBaseGraphQueryRo | null;
  presetId: string | null;
  focus: string | null;
  /** True when the URL carried a `q` that failed validation. */
  invalid: boolean;
}

const single = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value ?? null;

/**
 * The URL is the source of truth for WHAT is fetched, so a graph is linkable
 * and Back works. Panel edits `replace` (Back should not step through every
 * checkbox); preset switches `push`.
 */
export const useGraphQueryParam = () => {
  const router = useRouter();
  const q = single(router.query.q);
  const presetId = single(router.query.preset);
  const focus = single(router.query.focus);

  const state = useMemo<IGraphUrlState>(() => {
    const ro = decodeQuery(q);
    return { ro, presetId, focus, invalid: Boolean(q) && !ro };
  }, [q, presetId, focus]);

  const write = useCallback(
    (params: Record<string, string | undefined>, mode: 'push' | 'replace') => {
      const query: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(router.query)) {
        if (value !== undefined && !(key in params)) query[key] = value;
      }
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) query[key] = value;
      }
      router[mode]({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router]
  );

  /** Returns false when the query is too large for the URL; the caller saves a preset. */
  const setQuery = useCallback(
    (ro: IBaseGraphQueryRo, mode: 'push' | 'replace' = 'replace'): boolean => {
      const encoded = encodeQuery(ro);
      if (encoded.length > MAX_ENCODED_QUERY_LENGTH) return false;
      write({ q: encoded, preset: undefined }, mode);
      return true;
    },
    [write]
  );

  const setPreset = useCallback(
    (id: string) => write({ preset: id, q: undefined }, 'push'),
    [write]
  );

  const setFocus = useCallback(
    (nodeId: string | null) => write({ focus: nodeId ?? undefined }, 'replace'),
    [write]
  );

  return { ...state, setQuery, setPreset, setFocus };
};
