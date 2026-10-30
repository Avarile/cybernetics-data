import type { IClarifyOption, ISearchCard } from '@teable/openapi';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { laneMix } from '../../model/metrics';
import type { ILane } from '../../model/search-board';
import s from '../theme/cockpit.module.css';
import { RecordCard } from './RecordCard';

export interface ITableLaneProps {
  lane: ILane;
  /** The plan step the lane starts with (0-based), shown as its number. */
  index: number;
  how: string;
  cards: ISearchCard[];
  sourceOf: (card: ISearchCard) => ISearchCard | undefined;
  lit?: Set<string>;
  hover?: Set<string>;
  picks?: Map<string, IClarifyOption>;
  hrefOf: (card: ISearchCard) => string | undefined;
  tableHref?: string;
  onLeave?: () => void;
  onHover: (key?: string) => void;
  onPin: (key: string) => void;
  onPick: (option: IClarifyOption) => void;
}

const statusText: Partial<Record<ILane['status'], string>> = {
  running: 'SEARCHING…',
  empty: 'NO RECORDS',
  failed: 'FAILED',
  needs_choice: 'PICK ONE',
  cancelled: 'STOPPED',
};

/** One table of the search: its header and a card per record, in arrival order (§5.3). */
export const TableLane = (p: ITableLaneProps) => {
  const { t } = useTranslation('common');
  const { lane } = p;
  const mix = laneMix(lane, p.cards);
  const total = mix.reduce((n, [, c]) => n + c, 0);
  const count = lane.found > lane.shown ? `${lane.shown}/${lane.found}` : String(lane.shown);
  return (
    <section
      className={s.lane}
      data-status={lane.status}
      aria-label={lane.table}
      id={`lane-${lane.tableId}`}
    >
      <div className={s.laneHead}>
        <header>
          <span className={s.no}>{String(p.index + 1).padStart(2, '0')}</span>
          <span className={s.name}>{lane.table}</span>
          <span className={s.count}>{count}</span>
        </header>
        <span className={s.how}>
          {lane.purpose} · {p.how}
        </span>
        {total > 0 && (
          <div className={s.mix} aria-hidden>
            {mix.map(([tone, n]) => (
              <i key={tone} data-tone={tone} style={{ flex: n }} />
            ))}
          </div>
        )}
        {statusText[lane.status] && (
          <span className={lane.status === 'running' ? s.busy : s.err}>
            {t(`agent.cockpit.lane.${lane.status}`, statusText[lane.status]!)}
          </span>
        )}
        {lane.error && <span className={s.err}>{lane.error}</span>}
        {p.tableHref && (
          <Link href={p.tableHref} onClick={p.onLeave}>
            {t('agent.cockpit.openTable', 'Open the table')} ↗
          </Link>
        )}
      </div>
      <div className={s.cards}>
        {p.cards.map((card, i) => (
          <RecordCard
            key={card.key}
            card={card}
            index={i}
            source={p.sourceOf(card)}
            dim={Boolean(p.lit && !p.lit.has(card.key))}
            lit={Boolean(p.hover?.has(card.key))}
            pick={p.picks?.get(card.recordId)}
            href={p.hrefOf(card)}
            onLeave={p.onLeave}
            onHover={p.onHover}
            onPin={p.onPin}
            onPick={p.onPick}
          />
        ))}
        {p.cards.length === 0 && lane.status !== 'running' && (
          <p className={s.empty}>{t('agent.cockpit.noRecords', 'No records.')}</p>
        )}
      </div>
    </section>
  );
};
