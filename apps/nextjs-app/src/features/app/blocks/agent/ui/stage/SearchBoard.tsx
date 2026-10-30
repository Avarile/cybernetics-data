import type { IClarifyOption, ISearchCard } from '@teable/openapi';
import { memo, useCallback, useMemo } from 'react';
import {
  cardIndex,
  cardsOf,
  lanesOf,
  sourceOf,
  sourceText,
  type IBoard,
} from '../../model/search-board';
import s from '../theme/cockpit.module.css';
import { TableLane } from './TableLane';

export interface ISearchBoardProps {
  board: IBoard;
  lit?: Set<string>;
  hover?: Set<string>;
  picks?: Map<string, IClarifyOption>;
  baseHref?: string;
  onLeave?: () => void;
  onHover: (key?: string) => void;
  onPin: (key: string) => void;
  onPick: (option: IClarifyOption) => void;
}

/**
 * The search, one lane per table as it is searched (cockpit design §5.3). Memoized down to the
 * card: a reply streaming in the ask rail does not re-render it, and a hover re-renders only the
 * cards whose light changes.
 */
export const SearchBoard = memo((p: ISearchBoardProps) => {
  const { board, baseHref } = p;
  const lanes = useMemo(
    () =>
      lanesOf(board).map((lane) => ({
        lane,
        cards: cardsOf(board, lane),
        how: lane.stepIds.map((id) => sourceText(board.plan, id)).join(' · '),
      })),
    [board]
  );
  const cards = useMemo(() => cardIndex(board), [board]);
  const sourceOfCard = useCallback((card: ISearchCard) => sourceOf(cards, card), [cards]);
  const hrefOf = useCallback(
    (card: ISearchCard) =>
      baseHref ? `${baseHref}/${card.tableId}?recordId=${card.recordId}` : undefined,
    [baseHref]
  );
  return (
    <>
      <nav className={s.laneTabs} aria-label="Tables">
        {lanes.map(({ lane }) => (
          <a key={lane.tableId} className={s.knob} href={`#lane-${lane.tableId}`}>
            {lane.table}
          </a>
        ))}
      </nav>
      <div className={s.board} role="region" aria-label="Search board">
        {lanes.map(({ lane, cards: laneCards, how }, i) => (
          <TableLane
            key={lane.tableId}
            lane={lane}
            index={i}
            how={how}
            cards={laneCards}
            sourceOf={sourceOfCard}
            lit={p.lit}
            hover={p.hover}
            picks={p.picks}
            hrefOf={hrefOf}
            tableHref={baseHref ? `${baseHref}/${lane.tableId}` : undefined}
            onLeave={p.onLeave}
            onHover={p.onHover}
            onPin={p.onPin}
            onPick={p.onPick}
          />
        ))}
      </div>
    </>
  );
});

SearchBoard.displayName = 'SearchBoard';
