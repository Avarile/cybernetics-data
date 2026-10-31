/**
 * The ask panel's command line (scope design §6.2–§6.3): `/base <name>`, `/table <name>`, and
 * plain text, which is a search. Pure.
 */

export type ICommandName = 'base' | 'table';

export const COMMANDS: ICommandName[] = ['base', 'table'];

export type IParsed =
  | { kind: 'empty' }
  /** "/" or "/ba": a command name being typed. */
  | { kind: 'command-name'; partial: string }
  /** "/base", "/base dat": the argument is everything after the first space, trimmed. */
  | { kind: ICommandName; arg: string; spaced: boolean }
  | { kind: 'unknown-command'; name: string }
  | { kind: 'query'; text: string };

/** What the composer holds, read as a command or a query. A leading space makes it a query. */
export function parseInput(raw: string): IParsed {
  if (!raw.trim()) return { kind: 'empty' };
  if (!raw.startsWith('/')) return { kind: 'query', text: raw.trim() };
  const space = raw.indexOf(' ');
  const name = (space < 0 ? raw.slice(1) : raw.slice(1, space)).toLowerCase();
  const arg = space < 0 ? '' : raw.slice(space + 1).trim();
  if (space < 0 && !COMMANDS.includes(name as ICommandName))
    return COMMANDS.some((c) => c.startsWith(name))
      ? { kind: 'command-name', partial: name }
      : { kind: 'unknown-command', name };
  if (name === 'base' || name === 'table') return { kind: name, arg, spaced: space >= 0 };
  return { kind: 'unknown-command', name };
}

export interface INamed {
  id: string;
  name: string;
}

/** The words of a name: split on -, _, spaces and camelCase. */
const wordsOf = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

/**
 * Names matching what was typed (scope design §6.3, D10): those that start with it, in order;
 * only when none does, those with a word that starts with it. `dat` finds `data-centre` and not
 * `demo_database`.
 */
export function matchNames<T extends INamed>(items: T[], typed: string): T[] {
  const q = typed.trim().toLowerCase();
  if (!q) return items;
  const starts = items.filter((i) => i.name.toLowerCase().startsWith(q));
  if (starts.length) return starts;
  return items.filter((i) => wordsOf(i.name).some((w) => w.startsWith(q)));
}

/** The one item a command's argument names: an exact match, else the only one that matches. */
export function resolveName<T extends INamed>(items: T[], typed: string): T | undefined {
  const q = typed.trim().toLowerCase();
  if (!q) return undefined;
  const exact = items.filter((i) => i.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const matches = matchNames(items, q);
  return matches.length === 1 ? matches[0] : undefined;
}

export type ISuggestion =
  | { kind: 'command'; name: ICommandName }
  | { kind: 'base' | 'table'; id: string; name: string; isDefault?: boolean };

/** Suggestions shown at most. */
export const SUGGESTIONS_MAX = 50;

/** What the list under the input offers for what is typed. */
export function suggest(
  parsed: IParsed,
  bases: INamed[],
  tables: INamed[],
  defaultBaseId?: string | null
): ISuggestion[] {
  if (parsed.kind === 'command-name')
    return COMMANDS.filter((c) => c.startsWith(parsed.partial)).map((name) => ({
      kind: 'command' as const,
      name,
    }));
  if (parsed.kind === 'base') {
    const ordered = [
      ...bases.filter((b) => b.id === defaultBaseId),
      ...bases.filter((b) => b.id !== defaultBaseId),
    ];
    return matchNames(ordered, parsed.arg)
      .slice(0, SUGGESTIONS_MAX)
      .map((b) => ({ kind: 'base', id: b.id, name: b.name, isDefault: b.id === defaultBaseId }));
  }
  if (parsed.kind === 'table')
    return matchNames(tables, parsed.arg)
      .slice(0, SUGGESTIONS_MAX)
      .map((t) => ({ kind: 'table', id: t.id, name: t.name }));
  return [];
}

/** The input once a suggestion is completed (Tab): the command with the name, not applied yet. */
export const completed = (s: ISuggestion) =>
  s.kind === 'command' ? `/${s.name} ` : `/${s.kind} ${s.name}`;
