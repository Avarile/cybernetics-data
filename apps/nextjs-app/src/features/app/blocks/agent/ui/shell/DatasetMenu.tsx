import type { IOverviewDatasetId } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
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
import ds from '../theme/dataset.module.css';

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
 * The minute's progress and what comes next, beside the menu (overview design §4.2, §6). The
 * line is a CSS animation that pauses with the cycle; only the countdown re-renders, once a second.
 */
const DatasetNote = ({ cycle, onToggle }: { cycle: ICycle; onToggle: () => void }) => {
  const { t } = useTranslation('common');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = currentDataset(cycle);
  const next = nextDataset(cycle);
  if (!next) return null;
  const left = remainingAt(cycle, now);
  const held = cycle.holds.find((h) => h !== 'hidden') ?? cycle.holds[0];
  const userHeld = cycle.holds.some((h) => h === 'paused' || h === 'picked');
  return (
    <span className={ds.dsNote}>
      <span className={ds.track} aria-hidden>
        <i
          key={`${current}:${cycle.drawn}`}
          className={ds.progress}
          style={{
            animationDuration: `${DATASET_MS}ms`,
            animationDelay: `-${DATASET_MS - left}ms`,
            animationPlayState: running(cycle) ? 'running' : 'paused',
          }}
        />
      </span>
      <span>
        {held
          ? t(`agent.cockpit.overview.held.${held}`, holdText[held])
          : `${t('agent.cockpit.overview.next', 'NEXT')} ${t(`agent.cockpit.overview.${next}`, datasetInfo(next).chip)} · ${clock(left)}`}
      </span>
      <button
        type="button"
        className={s.knob}
        aria-pressed={userHeld}
        title={t('agent.cockpit.overview.pause', 'Pause or go on (P)')}
        onClick={onToggle}
      >
        {userHeld ? '▶' : '⏸'}
      </button>
    </span>
  );
};

/**
 * The annunciator's dataset menu (the cockpit's ds-menu): the dataset on the stage, its source,
 * and the list of the four with their keys. ↑/↓ open and move, Home/End, Enter or Space picks,
 * Escape closes back to the button; a click outside closes. A dataset that cannot be shown is
 * listed with why, and cannot be picked.
 */
export const DatasetMenu = ({
  cycle,
  failed,
  onOverview,
  onPick,
  onToggle,
}: {
  cycle: ICycle;
  failed: Partial<Record<IOverviewDatasetId, string>>;
  /** The overview is on the stage (else a search is, and a pick goes back to the overview). */
  onOverview: boolean;
  onPick: (id: IOverviewDatasetId) => void;
  onToggle: () => void;
}) => {
  const { t } = useTranslation('common');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = currentDataset(cycle) ?? OVERVIEW_ORDER[0].id;
  const chip = (d: IOverviewDatasetId) => t(`agent.cockpit.overview.${d}`, datasetInfo(d).chip);

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const show = () => {
    setActive(
      Math.max(
        0,
        OVERVIEW_ORDER.findIndex((d) => d.id === current)
      )
    );
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (i: number) => {
    const d = OVERVIEW_ORDER[i];
    if (!d || failed[d.id]) return;
    close(true);
    onPick(d.id);
  };
  const n = OVERVIEW_ORDER.length;
  const keys: Record<string, () => void> = {
    ArrowDown: () => setActive((active + 1) % n),
    ArrowUp: () => setActive((active - 1 + n) % n),
    Home: () => setActive(0),
    End: () => setActive(n - 1),
    Enter: () => pick(active),
    ' ': () => pick(active),
    Escape: () => close(true),
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'Tab') return setOpen(false);
    const action = keys[e.key];
    if (!action) return;
    action();
    // the cockpit's own keys (Escape, the views) stay out of the menu
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <span className={s.lbl} id={`${id}-label`}>
        {t('agent.cockpit.dataset', 'DATASET')}
      </span>
      <div ref={root} className={ds.dsMenu}>
        <button
          ref={button}
          type="button"
          className={s.menuButton}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-labelledby={`${id}-label ${id}-name`}
          onClick={() => (open ? close() : show())}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            show();
          }}
        >
          <b id={`${id}-name`}>{chip(current)}</b>
          <small>{datasetInfo(current).source}</small>
          <i className={s.caret} aria-hidden />
        </button>
        {open && (
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            aria-activedescendant={`${id}-${OVERVIEW_ORDER[active].id}`}
            tabIndex={-1}
            className={ds.dsList}
            onKeyDown={onListKey}
          >
            {OVERVIEW_ORDER.map((d, i) => (
              // the list takes the keys (aria-activedescendant); a click picks
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={d.id}
                id={`${id}-${d.id}`}
                role="option"
                aria-selected={onOverview && d.id === current}
                aria-disabled={Boolean(failed[d.id])}
                data-active={i === active}
                title={failed[d.id]}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <kbd>{i + 1}</kbd>
                <b>{chip(d.id)}</b>
                <small>{failed[d.id] ?? `${d.source} · ${d.about}`}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onOverview && <DatasetNote cycle={cycle} onToggle={onToggle} />}
    </>
  );
};
