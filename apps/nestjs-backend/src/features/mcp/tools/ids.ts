import { IdPrefix } from '@cybernetics/core';
import { z } from 'zod';

/**
 * Ids are prefix-typed in this codebase (spc/bse/tbl/viw/rec). Without this a
 * wrong-prefix id can pass the permission check — the caller may legitimately
 * hold rights on the resource it actually names — and then quietly match
 * nothing, so the model is told "no tables" instead of "wrong id".
 */
const prefixed = (prefix: IdPrefix, label: string, example: string) =>
  z
    .string()
    .startsWith(prefix, `A ${label} must start with "${prefix}", e.g. ${example}`)
    .describe(`The ${label}, e.g. ${example}`);

export const spaceIdSchema = prefixed(IdPrefix.Space, 'space id', 'spcXXXXXXXX');
export const baseIdSchema = prefixed(IdPrefix.Base, 'base id', 'bseXXXXXXXX');
export const tableIdSchema = prefixed(IdPrefix.Table, 'table id', 'tblXXXXXXXX');
export const viewIdSchema = prefixed(IdPrefix.View, 'view id', 'viwXXXXXXXX');
export const recordIdSchema = prefixed(IdPrefix.Record, 'record id', 'recXXXXXXXX');
