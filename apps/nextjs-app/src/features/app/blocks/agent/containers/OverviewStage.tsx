import type { IOverviewDatasetId } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { useOverview, useOverviewCycle } from '../hooks/useOverview';
import type { IGNode } from '../model/graph/types';
import { OVERVIEW_ORDER, datasetInfo } from '../model/overview/datasets';
import { useCockpitStore } from '../state/cockpit-store';
import { NodeDetail } from '../ui/stage/NodeDetail';
import { OverviewHead } from '../ui/stage/OverviewHead';
import { Legend, Readout } from '../ui/stage/Readout';
import { StageKnobs, type IStageView } from '../ui/stage/StageHead';
import s from '../ui/theme/cockpit.module.css';
import o from '../ui/theme/overview.module.css';
import { LazyConstellation } from './LazyConstellation';

const recordsOf = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([k]) => !k.includes('.'))
    .reduce((n, [, v]) => n + v, 0);

/**
 * The stage when no search is on it (overview design §4): the data base, one dataset a minute,
 * as a constellation with its readout, legend and the pinned node's strip.
 */
export const OverviewStage = ({ hasSearch }: { hasSearch: boolean }) => {
  const { t } = useTranslation('common');
  const ov = useOverview(true);
  useOverviewCycle(true);
  const store = useCockpitStore();
  const { cycle, cycleEvent, setStage, setView, setFocus, setDraft, pinOverview } = store;
  const chip = (id: IOverviewDatasetId) => t(`agent.cockpit.overview.${id}`, datasetInfo(id).chip);

  const pick = useCallback(
    (id: IOverviewDatasetId) => cycleEvent({ type: 'pick', id }),
    [cycleEvent]
  );
  const toggle = useCallback(() => {
    const held = useCockpitStore
      .getState()
      .cycle.holds.some((h) => h === 'paused' || h === 'picked');
    cycleEvent(held ? { type: 'resume' } : { type: 'hold', reason: 'paused' });
  }, [cycleEvent]);
  const pointer = useCallback(
    (inside: boolean) => cycleEvent({ type: inside ? 'hold' : 'release', reason: 'pointer' }),
    [cycleEvent]
  );
  const showSearch = (view: IStageView) => {
    setView(view);
    setStage('search');
  };
  /** ASK: the agent is pointed at the record, the composer gets the question to send or change. */
  const ask = (node: IGNode) => {
    if (!ov.vo || !node.recordId) return;
    setFocus({
      baseId: ov.vo.baseId,
      tableId: node.tableId,
      tableName: node.table?.toUpperCase(),
      rows: 1,
      recordIds: [node.recordId],
    });
    const what = (node.short ?? node.table ?? '').toLowerCase();
    setDraft(
      t('agent.cockpit.overview.askDraft', {
        what,
        title: node.label,
        defaultValue: `Tell me about the ${what} "${node.label}"`,
      })
    );
  };

  const missing = ov.vo?.missing.length
    ? `${t('agent.cockpit.missing', 'Not in this base')}: ${ov.vo.missing.join(', ')}`
    : undefined;
  const showing = ov.limited?.hidden
    ? t('agent.cockpit.showing', {
        shown: ov.limited.shown,
        total: ov.limited.total,
        defaultValue: `SHOWING ${ov.limited.shown} OF ${ov.limited.total}`,
      })
    : undefined;
  const stale = ov.error && ov.vo ? `STALE · ${ov.error}` : undefined;

  let body;
  if (!ov.available.length) {
    body = (
      <div className={o.message}>
        <b>{t('agent.cockpit.overview.nothing', 'NOTHING TO SHOW')}</b>
        {OVERVIEW_ORDER.map((d) => (
          <span key={d.id}>
            {chip(d.id)} · {ov.failed[d.id]}
          </span>
        ))}
      </div>
    );
  } else if (!ov.limited) {
    body = (
      <div className={o.message}>
        {t('agent.cockpit.overview.reading', {
          dataset: chip(ov.dataset),
          defaultValue: `READING ${chip(ov.dataset)}…`,
        })}
      </div>
    );
  } else {
    body = (
      <div key={ov.dataset} className={o.chart}>
        <LazyConstellation
          graph={ov.limited.graph}
          mode={store.layout}
          zoomResets={store.zoomResets}
          lit={ov.lit}
          onHover={ov.setHover}
          onPin={ov.pin}
          onPointerInside={pointer}
          labels={!ov.narrow}
        />
      </div>
    );
  }

  return (
    <section
      className={`${s.panel} ${s.stage}`}
      data-stage="overview"
      aria-label={t('agent.cockpit.overview.label', 'Overview')}
    >
      <div className={s.stageHead}>
        <Readout
          top={`${t('agent.cockpit.overview.title', 'OVERVIEW')} · ${chip(ov.dataset)}`}
          title={ov.vo?.path}
          notes={[missing, showing, stale]}
          metrics={ov.metrics}
          live={cycle.holds.includes('picked') ? 'polite' : 'off'}
        />
        <span className={s.spacer} />
        <div className={o.head}>
          <span>
            <StageKnobs
              mode="overview"
              hasSearch={hasSearch}
              view={store.view}
              layout={store.layout}
              onOverview={() => undefined}
              onView={showSearch}
              onLayout={store.setLayout}
            />
          </span>
          <OverviewHead cycle={cycle} failed={ov.failed} onPick={pick} onToggle={toggle} />
        </div>
      </div>
      <div className={s.stageBody}>
        {body}
        {ov.pinned && ov.vo && (
          <NodeDetail
            node={ov.pinned}
            baseId={ov.vo.baseId}
            onLeave={store.close}
            onAsk={ask}
            onClose={() => pinOverview(undefined)}
          />
        )}
      </div>
      <div className={s.stageFoot}>
        <Legend entries={datasetInfo(ov.dataset).legend} />
        {ov.vo && (
          <span className={o.info}>
            {t('agent.cockpit.overview.updated', 'UPDATED')} {ov.vo.builtAt.slice(11, 16)}Z ·{' '}
            {recordsOf(ov.vo.counts)} {t('agent.cockpit.overview.records', 'RECORDS')}
            {ov.vo.truncated ? ` · ${t('agent.cockpit.overview.truncated', 'MORE NOT READ')}` : ''}
          </span>
        )}
      </div>
    </section>
  );
};
