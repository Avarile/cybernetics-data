import type { IOverviewDatasetId } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import {
  currentDataset,
  nextDataset,
  remainingAt,
  running,
  type ICycle,
  type IHold,
} from '../../model/overview/cycle';
import { DATASET_MS, OVERVIEW_ORDER, datasetInfo } from '../../model/overview/datasets';
import s from '../theme/cockpit.module.css';
import o from '../theme/overview.module.css';

const holdText: Record<IHold, string> = {
  pointer: 'HELD · POINTER',
  pin: 'HELD · PINNED',
  picked: 'HELD · PICKED',
  paused: 'PAUSED',
  hidden: 'PAUSED',
};

const clock = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/**
 * The overview's dataset chips, the minute's progress and what comes next (overview design
 * §4.2, §6). The line is a CSS animation that pauses with the cycle; only the countdown text
 * re-renders, once a second.
 */
export const OverviewHead = ({
  cycle,
  failed,
  onPick,
  onToggle,
}: {
  cycle: ICycle;
  /** Datasets that cannot be shown, and why. */
  failed: Partial<Record<IOverviewDatasetId, string>>;
  onPick: (id: IOverviewDatasetId) => void;
  onToggle: () => void;
}) => {
  const { t } = useTranslation('common');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = currentDataset(cycle);
  const next = nextDataset(cycle);
  const run = running(cycle);
  const left = remainingAt(cycle, now);
  const held = cycle.holds.find((h) => h !== 'hidden') ?? cycle.holds[0];
  const userHeld = cycle.holds.some((h) => h === 'paused' || h === 'picked');

  return (
    <div className={o.head}>
      <span
        className={s.knobs}
        role="group"
        aria-label={t('agent.cockpit.overview.datasets', 'Datasets')}
      >
        {OVERVIEW_ORDER.map((d, i) => (
          <button
            key={d.id}
            type="button"
            className={s.knob}
            aria-pressed={d.id === current}
            disabled={Boolean(failed[d.id])}
            title={failed[d.id]}
            onClick={() => onPick(d.id)}
          >
            <small>{i + 1}</small> {t(`agent.cockpit.overview.${d.id}`, d.chip)}
          </button>
        ))}
        {next && (
          <button
            type="button"
            className={s.knob}
            aria-pressed={userHeld}
            title={t('agent.cockpit.overview.pause', 'Pause or go on (P)')}
            onClick={onToggle}
          >
            {userHeld ? '▶' : '⏸'}
          </button>
        )}
      </span>
      {next && (
        <span className={o.timer}>
          <span className={o.track} aria-hidden>
            <i
              key={`${current}:${cycle.drawn}`}
              className={o.progress}
              style={{
                animationDuration: `${DATASET_MS}ms`,
                animationDelay: `-${DATASET_MS - left}ms`,
                animationPlayState: run ? 'running' : 'paused',
              }}
            />
          </span>
          <span className={o.countdown}>
            {held
              ? t(`agent.cockpit.overview.held.${held}`, holdText[held])
              : `${t('agent.cockpit.overview.next', 'NEXT')} ${t(`agent.cockpit.overview.${next}`, datasetInfo(next).chip)} · ${clock(left)}`}
          </span>
        </span>
      )}
    </div>
  );
};
