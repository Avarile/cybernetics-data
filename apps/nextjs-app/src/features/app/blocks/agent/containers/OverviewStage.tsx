import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { useOverview, useOverviewCycle } from '../hooks/useOverview';
import type { IFrame } from '../model/graph/layout';
import type { IGNode } from '../model/graph/types';
import { overviewVectors } from '../model/panels';
import { useCockpitStore } from '../state/cockpit-store';
import { VectorsPanel } from '../ui/rail/RailPanels';
import { NodeDetail } from '../ui/stage/NodeDetail';
import { StageDeck } from '../ui/stage/StageDeck';
import { LayoutKnobs } from '../ui/stage/StageHead';
import o from '../ui/theme/overview.module.css';
import { LazyConstellation } from './LazyConstellation';

const recordsOf = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([k]) => !k.includes('.'))
    .reduce((n, [, v]) => n + v, 0);

/**
 * The stage when no search is on it (overview design §4, scope design §5.3): the current base,
 * one table a minute, as a constellation with the HUD's readout, legend and pinned node, and the
 * table's branches in the rail.
 */
export const OverviewStage = ({ rail }: { rail: HTMLElement | null }) => {
  const { t } = useTranslation('common');
  const ov = useOverview(true);
  useOverviewCycle(true);
  const store = useCockpitStore();
  const { cycle, cycleEvent, setFocus, setDraft, pinOverview } = store;
  const { info } = ov;
  const vectors = useMemo(
    () => (ov.graph ? overviewVectors(ov.graph, info) : []),
    [ov.graph, info]
  );
  const branchTitle = info.preset
    ? t(`agent.cockpit.rail.branches.${info.preset}`, info.branchTitle)
    : info.branchTitle;

  const unpin = useCallback(() => pinOverview(undefined), [pinOverview]);
  const pointer = useCallback(
    (inside: boolean) => cycleEvent({ type: inside ? 'hold' : 'release', reason: 'pointer' }),
    [cycleEvent]
  );
  /** A record's kind ("TASK"): the server's short, which the chart leaves out of its labels. */
  const kindOf = (id: string) => ov.vo?.nodes.find((n) => n.id === id)?.short ?? undefined;
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
    const what = (kindOf(node.id) ?? node.table ?? '').toLowerCase();
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
  const truncated = ov.vo?.truncated
    ? t('agent.cockpit.overview.truncated', 'MORE NOT READ')
    : undefined;
  const updated = ov.vo
    ? ` · ${t('agent.cockpit.overview.updated', 'UPDATED')} ${ov.vo.builtAt.slice(11, 16)}Z`
    : '';

  const chart = (frame: IFrame | null) => {
    if (ov.scope.tablesLoaded && !ov.available.length)
      return (
        <div className={o.message}>
          <b>{t('agent.cockpit.overview.nothing', 'NOTHING TO SHOW')}</b>
          {ov.scope.tables.map((table) => (
            <span key={table.id}>
              {table.name.toUpperCase()} · {ov.failed[table.id] ?? '—'}
            </span>
          ))}
        </div>
      );
    if (!ov.limited)
      return (
        <div className={o.message}>
          {t('agent.cockpit.overview.reading', {
            dataset: info.chip,
            defaultValue: `READING ${info.chip}…`,
          })}
        </div>
      );
    return (
      <div key={ov.tableId} className={o.fade}>
        <LazyConstellation
          graph={ov.limited.graph}
          mode={store.layout}
          zoomResets={store.zoomResets}
          lit={ov.lit}
          onHover={ov.setHover}
          onPin={ov.pin}
          onClear={unpin}
          onPointerInside={pointer}
          labels={!ov.narrow}
          frame={frame}
        />
      </div>
    );
  };

  return (
    <StageDeck
      stage="overview"
      label={t('agent.cockpit.overview.label', 'Overview')}
      title={ov.vo?.title ?? info.chip}
      path={ov.vo?.path}
      readout={{
        top: `${t('agent.cockpit.overview.title', 'OVERVIEW')}${updated}`,
        count: ov.vo ? recordsOf(ov.vo.counts) : '—',
        unit: t('agent.cockpit.overview.records', 'RECORDS'),
        notes: [missing, showing, truncated, stale],
        live: cycle.holds.includes('picked') ? 'polite' : 'off',
      }}
      metrics={ov.metrics}
      chart={chart}
      aside={
        ov.pinned &&
        ov.vo && (
          <NodeDetail
            node={ov.pinned}
            kind={kindOf(ov.pinned.id)}
            baseId={ov.vo.baseId}
            onLeave={store.close}
            onAsk={ask}
            onClose={unpin}
          />
        )
      }
      layout={<LayoutKnobs layout={store.layout} onLayout={store.setLayout} />}
      legend={info.legend}
      rail={rail}
      panels={
        <>
          <VectorsPanel
            title={branchTitle}
            hint={t('agent.cockpit.rail.branchHint', 'HOVER TO LIGHT BRANCH')}
            vectors={vectors}
            selected={store.overviewPinned}
            onHover={ov.setHover}
            onSelect={ov.pin}
          />
        </>
      }
    />
  );
};
