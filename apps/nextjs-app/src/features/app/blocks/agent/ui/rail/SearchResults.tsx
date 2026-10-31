import { useTranslation } from 'next-i18next';
import { logTime } from '../../model/format';
import type { IResultRow } from '../../model/search-results';
import p from '../theme/panels.module.css';

/** The snippet with its match marked. */
const Snippet = ({ row }: { row: IResultRow }) => {
  if (!row.snippet) return null;
  const { text, match } = row.snippet;
  return (
    <span className={p.snip}>
      <i>{row.snippet.field}</i> {text.slice(0, match[0])}
      <mark>{text.slice(match[0], match[1])}</mark>
      {text.slice(match[1])}
    </span>
  );
};

export interface ISearchResultsProps {
  /** The table searched, for the hint and the empty lines. */
  table: string;
  query?: string;
  total?: number;
  rows: IResultRow[];
  searching: boolean;
  error?: string;
  selected?: string;
  onHover: (recordId?: string) => void;
  onSelect: (recordId: string) => void;
  onClear: () => void;
}

/**
 * The Search Results panel (scope design §7.4, replacing RECENTLY UPDATED): every result of the
 * search with its tone on the chart, its snippet and when it changed. Pointing at a row lights
 * its trace; a click highlights it on the chart and opens it in the reader.
 */
export const SearchResults = (props: ISearchResultsProps) => {
  const { t } = useTranslation('common');
  const { table, query, total = 0, rows, searching, error, selected } = props;
  const title = t('agent.cockpit.results.title', 'SEARCH RESULTS');
  let hint = '';
  if (searching) hint = t('agent.cockpit.results.searching', 'SEARCHING…');
  else if (query && total > rows.length)
    hint = t('agent.cockpit.results.some', {
      shown: rows.length,
      total,
      table,
      defaultValue: `${rows.length} OF ${total} · ${table}`,
    });
  else if (query)
    hint = t('agent.cockpit.results.found', {
      total,
      table,
      defaultValue: `${total} FOUND · ${table}`,
    });

  let empty: string | undefined;
  if (error) empty = error;
  else if (!query)
    empty = t('agent.cockpit.results.idle', {
      table,
      defaultValue: `TYPE TO SEARCH ${table} · /table TO CHANGE`,
    });
  else if (!searching && !rows.length)
    empty = t('agent.cockpit.results.none', {
      query,
      table,
      defaultValue: `NOTHING MATCHES "${query}" IN ${table}`,
    });

  return (
    <section className={p.panel} aria-label={title} aria-busy={searching}>
      <h2>
        <span>
          {title} {hint && <small>{hint}</small>}
        </span>
        {query && (
          <button
            type="button"
            className={p.clear}
            aria-label={t('agent.cockpit.results.clear', 'Clear the search')}
            onClick={props.onClear}
          >
            ✕
          </button>
        )}
      </h2>
      <div className={`${p.body} ${p.resultsBody}`} onPointerLeave={() => props.onHover(undefined)}>
        {rows.map((row) => (
          <button
            key={row.recordId}
            type="button"
            className={p.result}
            aria-pressed={selected === row.recordId}
            data-on={selected === row.recordId}
            onPointerEnter={() => props.onHover(row.recordId)}
            onFocus={() => props.onHover(row.recordId)}
            onClick={() => props.onSelect(row.recordId)}
          >
            <header>
              <i className={p.dot} data-tone={row.tone} data-off={!row.onChart} aria-hidden />
              <span className={p.nm}>{row.title}</span>
              {!row.onChart && (
                <span className={p.off}>{t('agent.cockpit.results.offChart', 'OFF CHART')}</span>
              )}
              {row.updatedAt && <span className={p.tm}>{logTime(Date.parse(row.updatedAt))}</span>}
            </header>
            <Snippet row={row} />
          </button>
        ))}
        {empty && <p className={p.note}>{empty}</p>}
        {query && total > rows.length && !searching && (
          <p className={p.note}>
            {t('agent.cockpit.results.refine', {
              shown: rows.length,
              total,
              defaultValue: `SHOWING ${rows.length} OF ${total} · REFINE THE QUERY`,
            })}
          </p>
        )}
      </div>
    </section>
  );
};
