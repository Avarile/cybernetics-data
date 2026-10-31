import type { ICockpitTable } from '@teable/openapi';
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
import { DATASET_MS } from '../../model/overview/presentation';
import s from '../theme/cockpit.module.css';
import ds from '../theme/dataset.module.css';

const holdText: Record<IHold, string> = {
  pointer: 'HELD · POINTER',
  pin: 'HELD · PINNED',
  picked: 'HELD · PICKED',
  paused: 'PAUSED',
  hidden: 'PAUSED',
  search: 'HELD · SEARCH',
  typing: 'HELD · TYPING',
};

const clock = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/**
 * The minute's progress and the table that comes next, beside the menu (overview design §4.2, §6). The
 * line is a CSS animation that pauses with the cycle; only the countdown re-renders, once a second.
 */
const TableNote = ({
  cycle,
  nameOf,
  onToggle,
}: {
  cycle: ICycle;
  nameOf: (id: string) => string;
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
          : `${t('agent.cockpit.overview.next', 'NEXT')} ${nameOf(next)} · ${clock(left)}`}
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
 * The annunciator's table menu (the cockpit's ds-menu, scope design §5.3): the table on the
 * stage, its base, and the tables of the base with keys 1–9. ↑/↓ open and move, Home/End, Enter
 * or Space picks, Escape closes back to the button; a click outside closes. A table that cannot
 * be shown is listed with why, and cannot be picked.
 */
export const TableMenu = ({
  tables,
  baseName,
  cycle,
  failed,
  onOverview,
  onPick,
  onToggle,
}: {
  tables: ICockpitTable[];
  baseName: string;
  cycle: ICycle;
  failed: Record<string, string>;
  /** The overview is on the stage (else a search is, and a pick goes back to the overview). */
  onOverview: boolean;
  onPick: (id: string) => void;
  onToggle: () => void;
}) => {
  const { t } = useTranslation('common');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = currentDataset(cycle) ?? tables[0]?.id;
  const nameOf = (tableId?: string) =>
    (tables.find((x) => x.id === tableId)?.name ?? '—').toUpperCase();

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
    if (!tables.length) return;
    setActive(
      Math.max(
        0,
        tables.findIndex((x) => x.id === current)
      )
    );
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (i: number) => {
    const table = tables[i];
    if (!table || failed[table.id]) return;
    close(true);
    onPick(table.id);
  };
  const n = Math.max(1, tables.length);
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
        {t('agent.cockpit.tableLabel', 'TABLE')}
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
          <b id={`${id}-name`}>{nameOf(current)}</b>
          <small>{baseName.toUpperCase()}</small>
          <i className={s.caret} aria-hidden />
        </button>
        {open && (
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            aria-activedescendant={`${id}-${tables[active]?.id}`}
            tabIndex={-1}
            className={ds.dsList}
            onKeyDown={onListKey}
          >
            {tables.map((table, i) => (
              // the list takes the keys (aria-activedescendant); a click picks
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={table.id}
                id={`${id}-${table.id}`}
                role="option"
                aria-selected={onOverview && table.id === current}
                aria-disabled={Boolean(failed[table.id])}
                data-active={i === active}
                title={failed[table.id]}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <kbd>{i < 9 ? i + 1 : ''}</kbd>
                <b>{table.name.toUpperCase()}</b>
                <small>{failed[table.id] ?? baseName.toUpperCase()}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onOverview && <TableNote cycle={cycle} nameOf={nameOf} onToggle={onToggle} />}
    </>
  );
};
