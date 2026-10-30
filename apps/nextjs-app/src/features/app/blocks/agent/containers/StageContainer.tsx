import type { IClarifyOption } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { useAgentStatus } from '../hooks/useAgentData';
import { useStage } from '../hooks/useStage';
import type { ILensMode } from '../model/lens';
import type { IBoard } from '../model/search-board';
import { RunLog } from '../ui/log/RunLog';
import { Legend, Readout, StandbyStage } from '../ui/stage/Readout';
import { SearchBoard } from '../ui/stage/SearchBoard';
import { StageKnobs, type IStageView } from '../ui/stage/StageHead';
import s from '../ui/theme/cockpit.module.css';
import { LazyConstellation } from './LazyConstellation';
import { OverviewStage } from './OverviewStage';

/** No search on the stage: the overview, or why the agent cannot answer yet. */
const IdleStage = ({ hasSearch, onLeave }: { hasSearch: boolean; onLeave: () => void }) => {
  const { t } = useTranslation('common');
  const { data: agent } = useAgentStatus();
  const blocked =
    agent && (!agent.enabled || agent.status !== 'ok')
      ? agent.lastError ?? t('agent.panel.notReady', 'The agent needs setup.')
      : undefined;
  if (!blocked) return <OverviewStage hasSearch={hasSearch} />;
  return (
    <section
      className={`${s.panel} ${s.stage}`}
      aria-label={t('agent.cockpit.stage', 'Search board')}
    >
      <div className={s.stageBody}>
        <StandbyStage blocked={blocked} onLeave={onLeave} />
      </div>
    </section>
  );
};

/** The lens line of the readout, as an i18n key and its English. */
const lensLabelOf = (board: IBoard, lens: ILensMode): [string, string] => {
  if (board.status === 'running') return ['agent.cockpit.lens.searching', 'SEARCHING'];
  return lens === 'answer' && board.lens.length
    ? ['agent.cockpit.lens.answer', 'ANSWER']
    : ['agent.cockpit.lens.retrieved', 'RETRIEVED'];
};

/**
 * The stage: the overview of the data base by default, or the selected search as a board or a
 * constellation with its readout and log (cockpit design §5, overview design §4).
 */
export const StageContainer = ({
  onPick,
}: {
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

  if (stage.mode === 'overview' || !board?.plan)
    return <IdleStage hasSearch={stage.hasSearch} onLeave={stage.close} />;

  const [lensKey, lensEnglish] = lensLabelOf(board, stage.lensMode);
  const lensLabel = t(lensKey, lensEnglish);
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

  return (
    <section
      className={`${s.panel} ${s.stage}`}
      data-stage="search"
      aria-label={t('agent.cockpit.stage', 'Search board')}
    >
      <div className={s.stageHead}>
        <Readout
          top={`${board.plan.intent.replace(/_/g, ' ').toUpperCase()} · ${lensLabel}`}
          title={board.plan.summary}
          notes={[missing, showing]}
          metrics={stage.metrics}
        />
        <span className={s.spacer} />
        <StageKnobs
          mode="search"
          hasSearch
          view={stage.view}
          layout={stage.layout}
          lens={{
            mode: stage.lensMode,
            cited: board.lens.length,
            found: board.cards.length,
            onLens: stage.setLens,
          }}
          onOverview={() => stage.setStage('overview')}
          onView={showView}
          onLayout={stage.setLayout}
        />
      </div>
      <div className={s.stageBody}>
        {stage.view === 'constellation' && limited ? (
          <LazyConstellation
            graph={limited.graph}
            mode={stage.layout}
            zoomResets={stage.zoomResets}
            lens={stage.graphLens}
            lit={stage.graphLit}
            onHover={stage.hoverRecord}
            onPin={stage.pinRecord}
            onClear={stage.unpin}
          />
        ) : (
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
        )}
      </div>
      <RunLog board={board} />
      <div className={s.stageFoot}>
        <Legend />
      </div>
    </section>
  );
};
