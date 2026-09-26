import type { IBaseGraphQueryRo, IBaseGraphSchemaVo } from '@teable/openapi';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ISavedPreset } from '../presets';
import { BUILT_IN_PRESETS, defaultPreset, loadSavedPresets, storeSavedPresets } from '../presets';
import { useGraphQueryParam } from './useGraphQueryParam';

export interface IActiveQuery {
  ro: IBaseGraphQueryRo | null;
  /** Null when the URL carries an ad-hoc query rather than a preset. */
  presetId: string | null;
}

/**
 * Pure resolution: an explicit `q` wins, then a saved or built-in preset by id,
 * then the default preset. A built-in preset this base cannot satisfy (a table
 * is missing) falls through to the default rather than to an error page.
 */
export const resolveActiveQuery = (
  schema: IBaseGraphSchemaVo | undefined,
  urlRo: IBaseGraphQueryRo | null,
  urlPresetId: string | null,
  saved: ISavedPreset[]
): IActiveQuery => {
  if (urlRo) return { ro: urlRo, presetId: null };
  const savedPreset = saved.find((p) => p.id === urlPresetId);
  if (savedPreset) return { ro: savedPreset.ro, presetId: savedPreset.id };
  if (!schema) return { ro: null, presetId: null };
  const requested = BUILT_IN_PRESETS.find((p) => p.id === urlPresetId);
  const built = requested?.build(schema);
  if (requested && built?.ro) return { ro: built.ro, presetId: requested.id };
  const fallback = defaultPreset(schema);
  return { ro: fallback.build(schema).ro, presetId: fallback.id };
};

/** The query to fetch, and the actions that change it — all through the URL. */
export const useActiveQuery = (baseId: string, schema: IBaseGraphSchemaVo | undefined) => {
  const { t } = useTranslation(['baseGraph']);
  const url = useGraphQueryParam();
  const [saved, setSaved] = useState<ISavedPreset[]>(() => loadSavedPresets(baseId));

  const active = useMemo(
    () => resolveActiveQuery(schema, url.ro, url.presetId, saved),
    [schema, url.ro, url.presetId, saved]
  );

  useEffect(() => {
    if (url.invalid) toast.warning(t('baseGraph:error.invalidUrl'));
  }, [url.invalid, t]);

  const persist = useCallback(
    (next: ISavedPreset[]) => {
      setSaved(next);
      storeSavedPresets(baseId, next);
    },
    [baseId]
  );

  const savePreset = useCallback(
    (label: string, ro: IBaseGraphQueryRo) => {
      const preset = { id: `saved-${Date.now().toString(36)}`, label, ro };
      persist([...saved, preset]);
      url.setPreset(preset.id);
    },
    [persist, saved, url]
  );

  const setQuery = useCallback(
    (ro: IBaseGraphQueryRo) => {
      if (!url.setQuery(ro)) {
        // Too large for a link: keep it as a local preset instead of failing.
        savePreset(`${t('baseGraph:query.customPreset')} ${new Date().toLocaleTimeString()}`, ro);
        toast.message(t('baseGraph:query.tooLarge'));
      }
    },
    [savePreset, t, url]
  );

  const deletePreset = useCallback(
    (id: string) => {
      persist(saved.filter((p) => p.id !== id));
      if (active.presetId === id && schema) url.setPreset(defaultPreset(schema).id);
    },
    [active.presetId, persist, saved, schema, url]
  );

  return {
    ...active,
    savedPresets: saved,
    focus: url.focus,
    setFocus: url.setFocus,
    setQuery,
    setPreset: url.setPreset,
    savePreset,
    deletePreset,
  };
};
