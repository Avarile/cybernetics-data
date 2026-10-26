/**
 * Cell value <-> entity value for each field type the agent tables use. Reads are forgiving
 * (an admin may have typed anything into a cell); writes produce what the record API accepts.
 */
export interface ICodec<T> {
  read(value: unknown): T;
  write(value: T): unknown;
}

const blank = (v: unknown) => v === undefined || v === null || v === '';

export const text: ICodec<string | null> = {
  read: (v) => (blank(v) ? null : String(v)),
  write: (v) => (blank(v) ? null : v),
};

/** The primary field: never null in the entity. */
export const title: ICodec<string> = {
  read: (v) => (blank(v) ? '' : String(v)),
  write: (v) => v,
};

export const num: ICodec<number | null> = {
  read: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null),
  write: (v) => v,
};

export const bool: ICodec<boolean> = {
  read: (v) => v === true,
  // checkbox cells store null for "off"
  write: (v) => (v ? true : null),
};

export const strings: ICodec<string[]> = {
  read: (v) => (Array.isArray(v) ? v.map(String) : blank(v) ? [] : [String(v)]),
  write: (v) => (v.length ? v : null),
};

/** One host (or other item) per line. */
export const lines: ICodec<string[]> = {
  read: (v) =>
    blank(v)
      ? []
      : String(v)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
  write: (v) => (v.length ? v.join('\n') : null),
};

export const date: ICodec<string | null> = {
  read: (v) => (blank(v) ? null : String(v)),
  write: (v) => (blank(v) ? null : v),
};

const idOf = (v: unknown) =>
  v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null;

/** manyOne link, or a user cell: the id only. */
export const ref: ICodec<string | null> = {
  read: (v) => (Array.isArray(v) ? idOf(v[0]) : idOf(v)),
  write: (v) => (v ? { id: v } : null),
};

/** manyMany link: ids only. */
export const refs: ICodec<string[]> = {
  read: (v) =>
    (Array.isArray(v) ? v : blank(v) ? [] : [v]).map(idOf).filter((id): id is string => !!id),
  write: (v) => (v.length ? v.map((id) => ({ id })) : null),
};

/** A user cell is written by id. */
export const user: ICodec<string | null> = {
  read: ref.read,
  write: (v) => (v ? { id: v } : null),
};

/** Single select stored as its option name. */
export const choice = <T extends string>(): ICodec<T | null> => ({
  read: (v) => (blank(v) ? null : (String(v) as T)),
  write: (v) => (blank(v) ? null : v),
});
