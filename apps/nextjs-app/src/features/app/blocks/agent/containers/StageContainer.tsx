import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useAgentStatus } from '../hooks/useAgentData';
import { useStage } from '../hooks/useStage';
import type { IFrame } from '../model/graph/layout';
import type { ILensMode } from '../model/lens';
import { searchFeed, searchVectors } from '../model/panels';
import type { IBoard } from '../model/search-board';
import { FlightLog, VectorsPanel } from '../ui/rail/RailPanels';
import { SEARCH_LEGEND, StandbyStage } from '../ui/stage/Readout';
import { StageDeck } from '../ui/stage/StageDeck';
import { LayoutKnobs, LensChip } from '../ui/stage/StageHead';
import { LazyConstellation } from './LazyConstellation';
import { OverviewStage } from './OverviewStage';

interface IRail {
  rail: HTMLElement | null;
}

/** No search on the stage: the overview, or why the agent cannot answer yet. */
const IdleStage = ({ onLeave, rail }: IRail & { onLeave: () => void }) => {
  const { t } = useTranslation('common');
  const { data: agent } = useAgentStatus();
  const blocked =
    agent && (!agent.enabled || agent.status !== 'ok')
      ? agent.lastError ?? t('agent.panel.notReady', 'The agent needs setup.')
      : undefined;
  if (!blocked) return <OverviewStage rail={rail} />;
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

/**
 * The stage: the overview of the data base by default, or the selected search as a
 * constellation, with its readout, layout knobs, lens chip and legend in the HUD and its tables
 * and steps in the rail (cockpit design §5, overview design §4, scope design §4).
 */
export const StageContainer = ({ rail }: IRail) => {
  const { t } = useTranslation('common');
  const stage = useStage();
  const { board, limited } = stage;
  const vectors = useMemo(() => (board ? searchVectors(board) : []), [board]);
  const feed = useMemo(() => (board ? searchFeed(board) : []), [board]);

  if (stage.mode === 'overview' || !board?.plan)
    return <IdleStage onLeave={stage.close} rail={rail} />;

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
        limited
          ? (frame: IFrame | null) => (
              <LazyConstellation
                graph={limited.graph}
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
      layout={<LayoutKnobs layout={stage.layout} onLayout={stage.setLayout} />}
      aside={
        (running || answer) && (
          <LensChip
            searching={running}
            text={
              running
                ? t('agent.cockpit.lens.searchingChip', 'SEARCHING · THE CHART FILLS AS IT GOES')
                : t('agent.cockpit.lens.answerChip', {
                    n: cited,
                    defaultValue: `ANSWER · ${cited} RECORDS CITED`,
                  })
            }
            onOff={running ? undefined : () => stage.setLens('retrieved')}
          />
        )
      }
      legend={SEARCH_LEGEND}
      rail={rail}
      panels={
        <>
          <VectorsPanel
            title={t('agent.cockpit.rail.tables', 'TABLES')}
            hint={t('agent.cockpit.rail.tablesHint', 'WHAT EACH STEP FOUND')}
            vectors={vectors}
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
