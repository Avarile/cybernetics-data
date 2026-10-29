import type { IClarifyOption, ISearchCard } from '@teable/openapi';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import s from '../theme/cockpit.module.css';

export interface IRecordCardProps {
  card: ISearchCard;
  /** Position in its lane: staggers the entrance (at most 1.5 s). */
  index: number;
  /** The card it was reached from, for "via …". */
  source?: ISearchCard;
  dim: boolean;
  lit: boolean;
  /** The option a clarify card offers for this record (the anchor needs a choice). */
  pick?: IClarifyOption;
  href?: string;
  /** Following a link leaves the cockpit. */
  onLeave?: () => void;
  onHover: (key?: string) => void;
  onPin: (key: string) => void;
  onPick: (option: IClarifyOption) => void;
}

/** One record found by a search step (cockpit design §5.3, §6.7). */
export const RecordCard = ({
  card,
  index,
  source,
  dim,
  lit,
  pick,
  href,
  onLeave,
  onHover,
  onPin,
  onPick,
}: IRecordCardProps) => {
  const { t } = useTranslation('common');
  const via = card.via
    ? `${t('agent.cockpit.via', 'via')} ${source ? `${source.short ?? source.table} ${source.title}` : card.via.recordId} · ${card.via.field}`
    : undefined;
  return (
    <article
      className={s.card}
      data-tone={card.tone}
      data-alert={card.alert ? 'true' : undefined}
      data-archived={card.archived ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      data-lit={lit ? 'true' : undefined}
      style={{ ['--i' as string]: Math.min(index, 25) }}
    >
      <button
        type="button"
        className={s.cardMain}
        aria-pressed={lit}
        onMouseEnter={() => onHover(card.key)}
        onMouseLeave={() => onHover(undefined)}
        onFocus={() => onHover(card.key)}
        onBlur={() => onHover(undefined)}
        onClick={() => onPin(card.key)}
      >
        <span className={s.key}>
          <span>{card.short ?? card.table.toUpperCase()}</span>
          <span className={s.state}>
            {card.archived
              ? t('agent.cockpit.archived', 'ARCHIVED')
              : card.alert
                ? t('agent.cockpit.overdue', 'OVERDUE')
                : card.state}
          </span>
        </span>
        <span className={s.cardTitle}>{card.title}</span>
        {card.fields.length > 0 && (
          <span className={s.cardFields}>
            {card.fields.map((f) => (
              <span key={f.name}>
                <i>{f.name}</i>
                <b>{f.value}</b>
              </span>
            ))}
          </span>
        )}
        {card.snippet && <span className={s.snippet}>{card.snippet}</span>}
      </button>
      <footer>
        <span className={s.via}>{via ?? card.date ?? ''}</span>
        {pick ? (
          <button type="button" className={s.pick} onClick={() => onPick(pick)}>
            {t('agent.cockpit.pick', 'PICK')}
          </button>
        ) : (
          href && (
            <Link
              className={s.open}
              href={href}
              title={t('agent.cockpit.openRecord', 'Open the record')}
              onClick={onLeave}
            >
              <ExternalLink className="size-3" />
            </Link>
          )
        )}
      </footer>
    </article>
  );
};
