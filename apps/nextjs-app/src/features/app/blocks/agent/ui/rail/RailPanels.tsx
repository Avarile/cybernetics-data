import { useTranslation } from 'next-i18next';
import { Fragment } from 'react';
import type { IVector } from '../../model/panels';
import p from '../theme/panels.module.css';

/**
 * The vectors panel (the cockpit's branches): one row per branch, with its count, its tones and a stacked mix bar. Pointing at a row lights the branch on
 * the chart, a click keeps it lit.
 */
export const VectorsPanel = ({
  title,
  hint,
  vectors,
  selected,
  onHover,
  onSelect,
}: {
  title: string;
  hint?: string;
  vectors: IVector[];
  selected?: string;
  onHover?: (id?: string) => void;
  onSelect?: (id: string) => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <section className={p.panel} aria-label={title}>
      <h2>
        {title} {hint && <small>{hint}</small>}
      </h2>
      <div className={`${p.body} ${p.vectorsBody}`} onPointerLeave={() => onHover?.(undefined)}>
        {vectors.map((v) => (
          <button
            key={v.id}
            type="button"
            className={p.vec}
            data-on={selected === v.id}
            aria-pressed={selected === v.id}
            onPointerEnter={() => onHover?.(v.id)}
            onFocus={() => onHover?.(v.id)}
            onClick={() => onSelect?.(v.id)}
          >
            <header>
              <span className={p.nm}>
                {v.short ?? v.label}
                {v.short && <span>{v.label}</span>}
              </span>
              <span className={p.pc}>{v.right}</span>
            </header>
            {v.stack.length > 0 && (
              <div className={p.stack} aria-hidden>
                {v.stack.map(([tone, n]) => (
                  <i key={tone} data-tone={tone} style={{ flex: n }} />
                ))}
              </div>
            )}
            <div className={p.meta}>
              {v.facts.map((f, i) => (
                <Fragment key={f.text}>
                  {i ? ' · ' : ''}
                  <span data-tone={f.tone}>{f.text}</span>
                </Fragment>
              ))}
            </div>
          </button>
        ))}
        {!vectors.length && (
          <p className={p.note}>
            {t('agent.cockpit.rail.noVectors', 'Nothing to show for this dataset yet.')}
          </p>
        )}
      </div>
    </section>
  );
};
