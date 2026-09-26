import { useQueryClient } from '@tanstack/react-query';
import type { IBaseGraphSchemaVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IBaseGraphCanvasHandle } from './BaseGraphCanvas';
import { BaseGraphCanvas } from './BaseGraphCanvas';
import { BaseGraphCanvas2D } from './BaseGraphCanvas2D';
import { GraphToolbar } from './GraphToolbar';
import { useActiveQuery } from './hooks/useActiveQuery';
import { useBaseGraph, useExpandNode, useGraphSchema } from './hooks/useGraphData';
import { GraphLiveInvalidation } from './hooks/useGraphLiveInvalidation';
import { useResizeObserver } from './hooks/useResizeObserver';
import { GraphLegend } from './panels/GraphLegend';
import { GraphQueryPanel } from './panels/GraphQueryPanel';
import { NodeDetailPanel } from './panels/NodeDetailPanel';
import { NodeSearch } from './panels/NodeSearch';
import { RecordEditor } from './panels/RecordEditor';
import { BUILT_IN_PRESETS } from './presets';
import { GraphStoreProvider, useGraphActions, useGraphStore } from './store/GraphStoreProvider';
import {
  buildSimulationGraph,
  hiddenClosure,
  isLinkVisible,
  isNodeVisible,
} from './utils/buildSimulationGraph';
import { queryHash } from './utils/queryCodec';

/** Fixed light canvas; graphTheme.ts's palette is tuned for contrast against it. */
const CANVAS_BACKGROUND = '#f5f0e8';
const NO_HIDDEN = { hiddenNodeIds: [], hiddenTableIds: [] };
/** Above this, WebGL spheres and sprites get heavy; the flat renderer takes over. */
export const AUTO_2D_NODE_COUNT = 3000;

const Banner = ({ children }: { children: React.ReactNode }) => (
  <div className="shrink-0 border-b bg-amber-50 px-4 py-1 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
    {children}
  </div>
);

const BaseGraphInner = ({ baseId, schema }: { baseId: string; schema: IBaseGraphSchemaVo }) => {
  const { t } = useTranslation(['baseGraph']);
  const queryClient = useQueryClient();
  const query = useActiveQuery(baseId, schema);
  const { data, isLoading, isError, isFetching, refetch } = useBaseGraph(query.ro);
  const expandNode = useExpandNode();

  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const hiddenNodeIds = useGraphStore((s) => s.hiddenNodeIds);
  const hiddenTableIds = useGraphStore((s) => s.hiddenTableIds);
  const autoRotate = useGraphStore((s) => s.autoRotate);
  const showLegend = useGraphStore((s) => s.showLegend);
  const showQueryPanel = useGraphStore((s) => s.showQueryPanel);
  const expansions = useGraphStore((s) => s.expansions);
  const chosenRenderMode = useGraphStore((s) => s.renderMode);
  const actions = useGraphActions();

  const [editing, setEditing] = useState<{ tableId: string; recordId: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<IBaseGraphCanvasHandle>(null);
  const { width, height } = useResizeObserver(containerRef);

  // Expansions belong to the query they grew from.
  const hash = query.ro ? queryHash(query.ro) : '';
  const { clearExpansions } = actions;
  useEffect(() => clearExpansions(), [hash, clearExpansions]);

  const hidden = useMemo(
    () => ({ hiddenNodeIds, hiddenTableIds }),
    [hiddenNodeIds, hiddenTableIds]
  );
  // Derived, never stored — identity is the renderer's performance contract.
  const graph = useMemo(
    () => buildSimulationGraph(data, hidden, expansions),
    [data, hidden, expansions]
  );
  const full = useMemo(() => buildSimulationGraph(data, NO_HIDDEN, expansions), [data, expansions]);
  const closure = useMemo(() => hiddenClosure(full.nodes, hidden), [full, hidden]);

  const visibleCounts = useMemo(
    () => ({
      nodes: graph.nodes.filter(isNodeVisible).length,
      links: graph.links.filter(isLinkVisible).length,
    }),
    [graph]
  );
  const renderMode = chosenRenderMode ?? (visibleCounts.nodes > AUTO_2D_NODE_COUNT ? '2d' : '3d');
  const tableNames = useMemo(() => new Map(schema.tables.map((tb) => [tb.id, tb.name])), [schema]);
  const queryTables = useMemo(
    () =>
      (query.ro?.tables ?? []).map((q) => ({
        id: q.tableId,
        name: tableNames.get(q.tableId) ?? q.tableId,
      })),
    [query.ro, tableNames]
  );
  const searchable = useMemo(() => full.nodes.filter(isNodeVisible), [full]);
  const typeNodes = useMemo(() => full.nodes.filter((n) => n.tier === 'type'), [full]);
  const focused = useMemo(
    () => full.nodes.find((n) => n.id === focusedNodeId),
    [full, focusedNodeId]
  );

  const selectNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId) actions.setAutoRotate(false);
      actions.setFocusedNode(nodeId);
      query.setFocus(nodeId);
    },
    [actions, query]
  );

  const stopRotate = useCallback(() => actions.setAutoRotate(false), [actions]);

  const recenter = useCallback(() => {
    selectNode(null);
    actions.setAutoRotate(false);
    canvasRef.current?.recenterOnCore();
  }, [actions, selectNode]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseGraph(baseId) });
    queryClient.invalidateQueries({ queryKey: ['base-graph-node', baseId] });
  }, [baseId, queryClient]);

  const expand = useCallback(
    (linkFieldIds?: string[]) => {
      if (!focused?.recordId || !focused.tableId) return;
      expandNode.mutate(
        {
          tableId: focused.tableId,
          recordId: focused.recordId,
          linkFieldIds,
          exclude: full.nodes.map((n) => n.id),
        },
        {
          onSuccess: (vo) => {
            actions.addExpansion(vo);
            toast.message(t('baseGraph:detail.expanded', { count: vo.nodes.length }));
          },
        }
      );
    },
    [actions, expandNode, focused, full, t]
  );

  const truncatedTables = (data?.stats.perTable ?? [])
    .filter((p) => p.truncated)
    .map((p) => tableNames.get(p.tableId) ?? p.tableId);
  const hierarchyOf = (tableId: string) =>
    query.ro?.tables.find((q) => q.tableId === tableId)?.hierarchyFieldId;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Head>
        <title>{t('baseGraph:title')}</title>
      </Head>
      <GraphLiveInvalidation baseId={baseId} tableIds={queryTables.map((tb) => tb.id)} />

      <GraphToolbar
        tableCount={queryTables.length}
        visibleNodeCount={visibleCounts.nodes}
        visibleLinkCount={visibleCounts.links}
        autoRotate={autoRotate}
        onAutoRotateChange={actions.setAutoRotate}
        onRecenter={recenter}
        onResetView={actions.resetView}
        onRefresh={invalidate}
        isRefreshing={isFetching}
        fullscreenTargetRef={containerRef}
        showQueryPanel={showQueryPanel}
        onToggleQueryPanel={actions.toggleQueryPanel}
        renderMode={renderMode}
        onRenderModeChange={actions.setRenderMode}
      />
      {truncatedTables.length > 0 && (
        <Banner>{t('baseGraph:truncated.nodes', { tables: truncatedTables.join(', ') })}</Banner>
      )}
      {data?.stats.truncated.links && <Banner>{t('baseGraph:truncated.links')}</Banner>}

      <div className="flex min-h-0 flex-1">
        {showQueryPanel && (
          <GraphQueryPanel
            schema={schema}
            ro={query.ro}
            activePresetId={query.presetId}
            builtInPresets={BUILT_IN_PRESETS}
            savedPresets={query.savedPresets}
            onChange={query.setQuery}
            onPreset={query.setPreset}
            onSavePreset={(label) => query.ro && query.savePreset(label, query.ro)}
            onDeletePreset={query.deletePreset}
          />
        )}

        {/* overflow-hidden: a scrollbar around a measured canvas feeds back into ResizeObserver. */}
        <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
          {isLoading && <Skeleton className="size-full" />}

          {isError && (
            <div className="flex size-full items-center justify-center p-8">
              <Alert className="max-w-md">
                <AlertTitle>{t('baseGraph:error.title')}</AlertTitle>
                <AlertDescription className="mt-2">
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    {t('baseGraph:error.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {!isLoading && !isError && visibleCounts.nodes === 0 && (
            <div className="flex size-full flex-col items-center justify-center gap-1 p-8 text-center">
              <p className="text-sm font-medium">{t('baseGraph:empty.title')}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t('baseGraph:empty.description')}
              </p>
            </div>
          )}

          {/* A 0x0 first frame would initialise a 0x0 WebGL context. */}
          {data && visibleCounts.nodes > 0 && width > 0 && height > 0 && renderMode === '3d' && (
            <BaseGraphCanvas
              ref={canvasRef}
              graph={graph}
              width={width}
              height={height}
              backgroundColor={CANVAS_BACKGROUND}
              focusedNodeId={focusedNodeId}
              autoRotate={autoRotate}
              onNodeClick={selectNode}
              onUserInteract={stopRotate}
            />
          )}
          {data && visibleCounts.nodes > 0 && width > 0 && height > 0 && renderMode === '2d' && (
            <BaseGraphCanvas2D
              ref={canvasRef}
              graph={graph}
              width={width}
              height={height}
              backgroundColor={CANVAS_BACKGROUND}
              focusedNodeId={focusedNodeId}
              onNodeClick={selectNode}
              onUserInteract={stopRotate}
            />
          )}

          {data && (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-between gap-3 p-3">
              <div className="flex max-h-full flex-col gap-3">
                <NodeSearch
                  nodes={searchable}
                  tableNames={tableNames}
                  onSelect={selectNode}
                  onClear={() => selectNode(null)}
                />
                {showLegend && queryTables.length > 0 && (
                  <GraphLegend
                    tables={queryTables}
                    typeNodes={typeNodes}
                    hiddenIds={closure}
                    hiddenTableIds={hiddenTableIds}
                    onToggleNode={actions.toggleNode}
                    onToggleTable={actions.toggleTable}
                    onShowAll={actions.showAll}
                  />
                )}
              </div>

              {focused?.recordId && focused.tableId && (
                <NodeDetailPanel
                  recordId={focused.recordId}
                  tableId={focused.tableId}
                  hierarchyFieldId={hierarchyOf(focused.tableId)}
                  isExpanding={expandNode.isPending}
                  onExpand={expand}
                  onOpenRecord={() =>
                    setEditing({
                      tableId: focused.tableId as string,
                      recordId: focused.recordId as string,
                    })
                  }
                  onClose={() => selectNode(null)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <RecordEditor
          baseId={baseId}
          tableId={editing.tableId}
          recordId={editing.recordId}
          onClose={() => {
            setEditing(null);
            // The edit may have changed labels or links anywhere in the graph.
            invalidate();
          }}
        />
      )}
    </div>
  );
};

/**
 * Keyed by base: another base gets a fresh view store, so hidden ids and focus
 * never leak between bases. `focus` from the URL seeds the first selection.
 */
export const BaseGraph = () => {
  const baseId = useBaseId();
  const router = useRouter();
  const { t } = useTranslation(['baseGraph']);
  const schema = useGraphSchema();
  const focus = typeof router.query.focus === 'string' ? router.query.focus : null;

  if (!baseId || schema.isLoading) {
    return <Skeleton className="size-full" />;
  }
  if (schema.isError || !schema.data) {
    return (
      <div className="flex size-full items-center justify-center p-8">
        <Alert className="max-w-md">
          <AlertTitle>{t('baseGraph:error.title')}</AlertTitle>
          <AlertDescription className="mt-2">
            <Button variant="outline" size="sm" onClick={() => schema.refetch()}>
              {t('baseGraph:error.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <GraphStoreProvider key={baseId} initialFocus={focus}>
      <BaseGraphInner baseId={baseId} schema={schema.data} />
    </GraphStoreProvider>
  );
};
