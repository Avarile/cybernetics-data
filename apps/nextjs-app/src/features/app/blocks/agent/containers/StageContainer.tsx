import type { IClarifyOption } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { useAgentStatus } from '../hooks/useAgentData';
import { useStage } from '../hooks/useStage';
import type { IFrame } from '../model/graph/layout';
import type { ILensMode } from '../model/lens';
import { searchFeed, searchVectors } from '../model/panels';
import type { IBoard } from '../model/search-board';
import { FlightLog, VectorsPanel } from '../ui/rail/RailPanels';
import { SEARCH_LEGEND, StandbyStage } from '../ui/stage/Readout';
import { SearchBoard } from '../ui/stage/SearchBoard';
import { StageDeck } from '../ui/stage/StageDeck';
import { LensChip, StageKnobs, type IStageView } from '../ui/stage/StageHead';
import { LazyConstellation } from './LazyConstellation';
import { OverviewStage } from './OverviewStage';

interface IRail {
  rail: HTMLElement | null;
}

/** No search on the stage: the overview, or why the agent cannot answer yet. */
const IdleStage = ({
  hasSearch,
  onLeave,
  rail,
}: IRail & { hasSearch: boolean; onLeave: () => void }) => {
  const { t } = useTranslation('common');
  const { data: agent } = useAgentStatus();
  const blocked =
    agent && (!agent.enabled || agent.status !== 'ok')
      ? agent.lastError ?? t('agent.panel.notReady', 'The agent needs setup.')
      : undefined;
  if (!blocked) return <OverviewStage hasSearch={hasSearch} rail={rail} />;
  return (
    <StageDeck
      label={t('agent.cockpit.stage', 'Search board')}
      title={t('agent.cockpit.title', 'AGENT COCKPIT')}
      chart={() => <StandbyStage blocked={blocked} onLeave={onLeave} />}
      rail={rail}
    />
  );
};

/**
 * What the readout says of a search (as i18n keys and their English): searching, the records
 * the answer cites, or every record found.
 */
const readoutOf = (board: IBoard, lensMode: ILensMode, cited: number) => {
  const running = board.status === 'running';
  const answer = !running && lensMode === 'answer' && board.lens.length > 0;
  let top: [string, string] = ['agent.cockpit.lens.retrieved', 'RETRIEVED'];
  if (running) top = ['agent.cockpit.lens.searching', 'SEARCHING'];
  else if (answer) top = ['agent.cockpit.lens.answer', 'ANSWER'];
  const unit: [string, string] = answer
    ? ['agent.cockpit.readout.cited', 'RECORDS CITED']
    : ['agent.cockpit.readout.found', 'RECORDS FOUND'];
  const count = answer ? cited : new Set(board.cards.map((c) => c.recordId)).size;
  return { running, answer, top, unit, count };
};

/** The scroll of the board to a table's lane, from the vectors panel. */
const toLane = (tableId: string) =>
  document
    .getElementById(`lane-${tableId}`)
    ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });

/**
 * The stage: the overview of the data base by default, or the selected search as a board or a
 * constellation, with its readout, lens chip and legend in the HUD and its tables and steps in
 * the rail (cockpit design §5, overview design §4).
 */
export const StageContainer = ({
  onPick,
  rail,
}: IRail & {
  onPick: (option: IClarifyOption, clarifyId: string) => void;
}) => {
  const { t } = useTranslation('common');
  const stage = useStage();
  const { board, limited } = stage;
  const clarifyId = stage.clarify?.clarifyId;
  const pickOption = useCallback(
    (option: IClarifyOption) => clarifyId && onPick(option, clarifyId),
    [clarifyId, onPick]
  );
  const vectors = useMemo(() => (board ? searchVectors(board) : []), [board]);
  const feed = useMemo(() => (board ? searchFeed(board) : []), [board]);

  if (stage.mode === 'overview' || !board?.plan)
    return <IdleStage hasSearch={stage.hasSearch} onLeave={stage.close} rail={rail} />;

  const cited = stage.graphLens?.size ?? 0;
  const { running, answer, top, unit, count } = readoutOf(board, stage.lensMode, cited);
  const showing = limited?.hidden
    ? t('agent.cockpit.showing', {
        shown: limited.shown,
        total: limited.total,
        defaultValue: `SHOWING ${limited.shown} OF ${limited.total}`,
      })
    : undefined;
  const missing = board.plan.missing.length
    ? `${t('agent.cockpit.missing', 'Not in this base')}: ${board.plan.missing.join(', ')}`
    : undefined;
  const showView = (view: IStageView) => {
    stage.setView(view);
    stage.setStage('search');
  };
  const constellation = stage.view === 'constellation' && limited;

  return (
    <StageDeck
      stage="search"
      label={t('agent.cockpit.stage', 'Search board')}
      title={board.plan.intent.replace(/_/g, ' ').toUpperCase()}
      path={board.plan.summary}
      readout={{
        top: t(...top),
        count,
        unit: t(...unit),
        notes: [missing, showing],
        lens: answer,
      }}
      metrics={stage.metrics}
      chart={
        constellation
          ? (frame: IFrame | null) => (
              <LazyConstellation
                graph={constellation.graph}
                mode={stage.layout}
                zoomResets={stage.zoomResets}
                lens={stage.graphLens}
                lit={stage.graphLit}
                onHover={stage.hoverRecord}
                onPin={stage.pinRecord}
                onClear={stage.unpin}
                frame={frame}
              />
            )
          : undefined
      }
      board={
        !constellation && (
          <SearchBoard
            board={board}
            lit={stage.lit}
            hover={stage.trace}
            picks={stage.picks}
            baseHref={`/base/${board.plan.baseId}`}
            onLeave={stage.close}
            onHover={stage.setHover}
            onPin={stage.pin}
            onPick={pickOption}
          />
        )
      }
      aside={
        (running || answer) && (
          <LensChip
            searching={running}
            text={
              running
                ? t('agent.cockpit.lens.searchingChip', 'SEARCHING · THE BOARD FILLS AS IT GOES')
                : t('agent.cockpit.lens.answerChip', {
                    n: cited,
                    defaultValue: `ANSWER · ${cited} RECORDS CITED`,
                  })
            }
            onOff={running ? undefined : () => stage.setLens('retrieved')}
          />
        )
      }
      knobs={
        <StageKnobs
          mode="search"
          hasSearch
          view={stage.view}
          layout={stage.layout}
          onOverview={() => stage.setStage('overview')}
          onView={showView}
          onLayout={stage.setLayout}
        />
      }
      legend={SEARCH_LEGEND}
      rail={rail}
      panels={
        <>
          <VectorsPanel
            title={t('agent.cockpit.rail.tables', 'TABLES')}
            hint={t('agent.cockpit.rail.tablesHint', 'WHAT EACH STEP FOUND')}
            vectors={vectors}
            onSelect={stage.view === 'board' ? toLane : undefined}
          />
          <FlightLog
            title={t('agent.cockpit.rail.log', 'FLIGHT LOG')}
            hint={t('agent.cockpit.rail.logHint', 'STEPS · UTC')}
            rows={feed}
            empty={t('agent.cockpit.rail.noSteps', 'No steps yet.')}
          />
        </>
      }
    />
  );
};
