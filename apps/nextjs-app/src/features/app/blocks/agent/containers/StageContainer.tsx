import type { IClarifyOption } from '@teable/openapi';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import { useAgentStatus } from '../hooks/useAgentData';
import { useStage } from '../hooks/useStage';
import { RunLog } from '../ui/log/RunLog';
import { Legend, Readout, StandbyStage } from '../ui/stage/Readout';
import { SearchBoard } from '../ui/stage/SearchBoard';
import { StageKnobs } from '../ui/stage/StageHead';
import s from '../ui/theme/cockpit.module.css';

// d3 loads with the constellation only, so the board never pays for it
const Constellation = dynamic(
  () => import('../ui/stage/Constellation').then((m) => m.Constellation),
  { ssr: false }
);

/** The stage: the selected search as a board or a constellation, its readout and log. */
export const StageContainer = ({
  onPick,
}: {
  onPick: (option: IClarifyOption, clarifyId: string) => void;
}) => {
  const { t } = useTranslation('common');
  const stage = useStage();
  const { data: agent } = useAgentStatus();
  const { board, limited } = stage;

  if (!board?.plan) {
    const blocked =
      agent && (!agent.enabled || agent.status !== 'ok')
        ? agent.lastError ?? t('agent.panel.notReady', 'The agent needs setup.')
        : undefined;
    return (
      <section
        className={`${s.panel} ${s.stage}`}
        aria-label={t('agent.cockpit.stage', 'Search board')}
      >
        <div className={s.stageBody}>
          <StandbyStage blocked={blocked} onLeave={stage.close} />
        </div>
      </section>
    );
  }

  const lensLabel =
    board.status === 'running'
      ? t('agent.cockpit.lens.searching', 'SEARCHING')
      : stage.lensMode === 'answer' && board.lens.length
        ? t('agent.cockpit.lens.answer', 'ANSWER')
        : t('agent.cockpit.lens.retrieved', 'RETRIEVED');
  const note = limited?.hidden
    ? t('agent.cockpit.showing', {
        shown: limited.shown,
        total: limited.total,
        defaultValue: `SHOWING ${limited.shown} OF ${limited.total}`,
      })
    : undefined;

  return (
    <section
      className={`${s.panel} ${s.stage}`}
      aria-label={t('agent.cockpit.stage', 'Search board')}
    >
      <div className={s.stageHead}>
        <Readout plan={board.plan} metrics={stage.metrics} lensLabel={lensLabel} note={note} />
        <span className={s.spacer} />
        <StageKnobs
          view={stage.view}
          layout={stage.layout}
          lens={stage.lensMode}
          cited={board.lens.length}
          found={board.cards.length}
          onView={stage.setView}
          onLayout={stage.setLayout}
          onLens={stage.setLens}
        />
      </div>
      <div className={s.stageBody}>
        {stage.view === 'constellation' && limited ? (
          <Constellation
            graph={limited.graph}
            mode={stage.layout}
            lens={stage.graphLens}
            lit={stage.graphLit}
            onHover={stage.hoverRecord}
            onPin={stage.pinRecord}
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
            onPick={(o) => stage.clarify && onPick(o, stage.clarify.clarifyId)}
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
