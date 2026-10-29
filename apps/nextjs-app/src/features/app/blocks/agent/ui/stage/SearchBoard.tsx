import type { IClarifyOption, ISearchCard } from '@teable/openapi';
import { cardsOf, lanesOf, sourceOf, sourceText, type IBoard } from '../../model/search-board';
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

/** The search, one lane per table as it is searched (cockpit design §5.3). */
export const SearchBoard = (p: ISearchBoardProps) => {
  const lanes = lanesOf(p.board);
  const hrefOf = (card: ISearchCard) =>
    p.baseHref ? `${p.baseHref}/${card.tableId}?recordId=${card.recordId}` : undefined;
  return (
    <>
      <nav className={s.laneTabs} aria-label="Tables">
        {lanes.map((lane) => (
          <a key={lane.tableId} className={s.knob} href={`#lane-${lane.tableId}`}>
            {lane.table}
          </a>
        ))}
      </nav>
      <div className={s.board} role="region" aria-label="Search board">
        {lanes.map((lane, i) => (
          <TableLane
            key={lane.tableId}
            lane={lane}
            index={i}
            how={lane.stepIds.map((id) => sourceText(p.board.plan, id)).join(' · ')}
            cards={cardsOf(p.board, lane)}
            sourceOf={(card) => sourceOf(p.board, card)}
            lit={p.lit}
            hover={p.hover}
            picks={p.picks}
            hrefOf={hrefOf}
            tableHref={p.baseHref ? `${p.baseHref}/${lane.tableId}` : undefined}
            onLeave={p.onLeave}
            onHover={p.onHover}
            onPin={p.onPin}
            onPick={p.onPick}
          />
        ))}
      </div>
    </>
  );
};
