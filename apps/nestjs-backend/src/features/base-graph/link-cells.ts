import type { ILinkCellValue } from '@teable/core';

const isLinkCell = (v: unknown): v is ILinkCellValue =>
  typeof v === 'object' && v !== null && 'id' in v && typeof (v as ILinkCellValue).id === 'string';

/**
 * The linked record out of a single-valued link cell. Callers assert the field
 * is single-valued before reading, so there is no multi-value case to silently
 * drop here.
 */
export const extractLinkCell = (raw: unknown): ILinkCellValue | null =>
  isLinkCell(raw) ? raw : null;

export const extractLinkRecordId = (raw: unknown): string | null =>
  extractLinkCell(raw)?.id ?? null;

/** Every linked recordId out of a link cell, single- or multi-valued. */
export const extractRelatedRecordIds = (raw: unknown): string[] => {
  if (raw == null) {
    return [];
  }
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter(isLinkCell).map((v) => v.id);
};
