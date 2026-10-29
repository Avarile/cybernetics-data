import type { IClarifyOption } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useAgentStatus } from '../hooks/useAgentData';
import { useSearchBoard } from '../hooks/useSearchBoard';
import { defaultLens, lensKeys } from '../model/lens';
import { metricsOf } from '../model/metrics';
import { traceOf } from '../model/search-board';
import { openClarify } from '../model/transcript';
import { useCockpitStore } from '../state/cockpit-store';
import { RunLog } from '../ui/log/RunLog';
import { Legend, Readout, StandbyStage } from '../ui/stage/Readout';
import { SearchBoard } from '../ui/stage/SearchBoard';
import s from '../ui/theme/cockpit.module.css';

/** The stage: the search board of the selected search, its readout and log (§5.3, §5.6). */
export const StageContainer = ({
  onPick,
}: {
  onPick: (option: IClarifyOption, clarifyId: string) => void;
}) => {
  const { t } = useTranslation('common');
  const { board, chat } = useSearchBoard();
  const { data: agent } = useAgentStatus();
  const lensMode = useCockpitStore((st) => st.lens) ?? defaultLens(board);
  const setLens = useCockpitStore((st) => st.setLens);
  const pinned = useCockpitStore((st) => st.pin);
  const pinnedKey = useCockpitStore((st) => st.pinned);
  const close = useCockpitStore((st) => st.close);
  const [hover, setHover] = useState<string>();

  const trace = useMemo(
    () => (board && (hover ?? pinnedKey) ? traceOf(board, (hover ?? pinnedKey)!) : undefined),
    [board, hover, pinnedKey]
  );
  const lit = lensKeys(board, lensMode, trace);
  const metrics = useMemo(
    () => (board ? metricsOf(board, lensMode === 'answer' ? lit : undefined) : []),
    [board, lensMode, lit]
  );
  const clarify = openClarify(chat.messages);
  const picks = useMemo(() => {
    if (!clarify || board?.status !== 'needs_choice') return undefined;
    return new Map(
      clarify.options.filter((o) => o.recordRef).map((o) => [o.recordRef!.recordId, o])
    );
  }, [clarify, board?.status]);
  const blocked =
    agent && (!agent.enabled || agent.status !== 'ok')
      ? agent.lastError ?? t('agent.panel.notReady', 'The agent needs setup.')
      : undefined;
  const lensLabel =
    board?.status === 'running'
      ? t('agent.cockpit.lens.searching', 'SEARCHING')
      : lensMode === 'answer' && board?.lens.length
        ? t('agent.cockpit.lens.answer', 'ANSWER')
        : t('agent.cockpit.lens.retrieved', 'RETRIEVED');

  return (
    <section
      className={`${s.panel} ${s.stage}`}
      aria-label={t('agent.cockpit.stage', 'Search board')}
    >
      {board?.plan ? (
        <>
          <div className={s.stageHead}>
            <Readout plan={board.plan} metrics={metrics} lensLabel={lensLabel} />
            <span className={s.spacer} />
            <span
              className={s.knobs}
              role="group"
              aria-label={t('agent.cockpit.lens.label', 'Lens')}
            >
              <button
                type="button"
                className={s.knob}
                aria-pressed={lensMode === 'answer'}
                disabled={!board.lens.length}
                onClick={() => setLens('answer')}
              >
                {t('agent.cockpit.lens.answer', 'ANSWER')} {board.lens.length}
              </button>
              <button
                type="button"
                className={s.knob}
                aria-pressed={lensMode === 'retrieved'}
                onClick={() => setLens('retrieved')}
              >
                {t('agent.cockpit.lens.retrieved', 'RETRIEVED')} {board.cards.length}
              </button>
            </span>
          </div>
          <div className={s.stageBody}>
            <SearchBoard
              board={board}
              lit={lit}
              hover={trace}
              picks={picks}
              baseHref={`/base/${board.plan.baseId}`}
              onLeave={close}
              onHover={setHover}
              onPin={(key) => pinned(pinnedKey === key ? undefined : key)}
              onPick={(o) => clarify && onPick(o, clarify.clarifyId)}
            />
          </div>
          <RunLog board={board} />
          <div className={s.stageFoot}>
            <Legend />
          </div>
        </>
      ) : (
        <div className={s.stageBody}>
          <StandbyStage blocked={blocked} onLeave={close} />
        </div>
      )}
    </section>
  );
};
