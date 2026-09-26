import { RotateCw } from '@teable/icons';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { Maximize2, Minimize2, Crosshair, PanelLeft, Pause, Play, Target } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { RefObject } from 'react';
import { useFullscreen } from './hooks/useFullscreen';

interface IGraphToolbarProps {
  tableCount: number;
  visibleNodeCount: number;
  visibleLinkCount: number;
  autoRotate: boolean;
  onAutoRotateChange: (on: boolean) => void;
  /** Frames the base hub again, without touching the legend filters. */
  onRecenter: () => void;
  onResetView: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /**
   * The same element the canvas attaches its interaction listeners to. If they
   * differ, entering fullscreen re-parents one and not the other, and
   * auto-rotate stops yielding to the user exactly where it is most visible.
   */
  fullscreenTargetRef: RefObject<HTMLElement>;
  showQueryPanel: boolean;
  onToggleQueryPanel: () => void;
  renderMode: '3d' | '2d';
  onRenderModeChange: (mode: '3d' | '2d') => void;
}

export const GraphToolbar = (props: IGraphToolbarProps) => {
  const {
    tableCount,
    visibleNodeCount,
    visibleLinkCount,
    autoRotate,
    onAutoRotateChange,
    onRecenter,
    onResetView,
    onRefresh,
    isRefreshing,
    fullscreenTargetRef,
    showQueryPanel,
    onToggleQueryPanel,
    renderMode,
    onRenderModeChange,
  } = props;
  const { t } = useTranslation(['baseGraph']);
  const { isFullscreen, toggle } = useFullscreen(fullscreenTargetRef);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-background/95 px-4 py-1.5 backdrop-blur">
      <Button
        variant={showQueryPanel ? 'secondary' : 'ghost'}
        size="xs"
        onClick={onToggleQueryPanel}
        aria-pressed={showQueryPanel}
        title={t('baseGraph:toolbar.query')}
      >
        <PanelLeft className="size-3.5" />
      </Button>
      <h1 className="text-sm font-semibold">{t('baseGraph:title')}</h1>

      <Separator orientation="vertical" className="h-5" />

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t('baseGraph:stats.tables', { count: tableCount })}</span>
        <span>{t('baseGraph:stats.nodes', { count: visibleNodeCount })}</span>
        <span>{t('baseGraph:stats.links', { count: visibleLinkCount })}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onRenderModeChange(renderMode === '3d' ? '2d' : '3d')}
          title={t('baseGraph:toolbar.renderMode')}
        >
          {renderMode === '3d' ? '2D' : '3D'}
        </Button>

        {/*
          A button rather than a switch: it sits with the other canvas controls,
          and `secondary` while running makes the state readable at a glance.
        */}
        {renderMode === '3d' && (
          <Button
            variant={autoRotate ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => onAutoRotateChange(!autoRotate)}
            aria-pressed={autoRotate}
            title={
              autoRotate ? t('baseGraph:toolbar.stopRotate') : t('baseGraph:toolbar.startRotate')
            }
          >
            {autoRotate ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {t('baseGraph:toolbar.autoRotate')}
          </Button>
        )}

        {/*
          Labelled rather than icon-only, unlike its neighbours to the right:
          this moves the camera while the Crosshair beside it clears the legend
          filters, and two adjacent reticle glyphs separated only by a tooltip
          would be a coin toss for the user.
        */}
        <Button variant="ghost" size="xs" onClick={onRecenter}>
          <Target className="size-3.5" />
          {t('baseGraph:toolbar.recenter')}
        </Button>

        <Button
          variant="ghost"
          size="xs"
          onClick={onResetView}
          title={t('baseGraph:toolbar.resetView')}
        >
          <Crosshair className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="xs"
          onClick={onRefresh}
          disabled={isRefreshing}
          title={t('baseGraph:toolbar.refresh')}
        >
          <RotateCw className={isRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>

        <Button
          variant="ghost"
          size="xs"
          onClick={toggle}
          title={
            isFullscreen ? t('baseGraph:toolbar.exitFullscreen') : t('baseGraph:toolbar.fullscreen')
          }
        >
          {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
};
