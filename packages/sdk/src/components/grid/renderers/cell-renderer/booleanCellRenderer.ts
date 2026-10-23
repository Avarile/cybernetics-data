import { GRID_DEFAULT } from '../../configs';
import { inRange } from '../../utils';
import { drawCheckbox } from '../base-renderer';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  IBooleanCell,
  ICellClickProps,
  ICellClickCallback,
} from './interface';

const { cellHorizontalPadding } = GRID_DEFAULT;

export const booleanCellRenderer: IInternalCellRenderer<IBooleanCell> = {
  type: CellType.Boolean,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IBooleanCell, props: ICellRenderProps) => {
    const { data, isMultiple, contentAlign = 'center' } = cell;
    const { ctx, rect, theme } = props;
    const { x, y, width, height } = rect;
    const { iconSizeSM, staticWhite, iconBgSelected, interactionLineColorCommon } = theme;
    const halfIconSize = iconSizeSM / 2;

    if (!isMultiple) {
      let textOffsetX = width / 2 - halfIconSize;

      if (contentAlign === 'left') {
        textOffsetX = cellHorizontalPadding;
      } else if (contentAlign === 'right') {
        textOffsetX = width - cellHorizontalPadding - iconSizeSM;
      }

      // 16px box with 3px corners drawn inside the unchanged 20px click target
      return drawCheckbox(ctx, {
        x: x + textOffsetX + 2,
        y: y + height / 2 - halfIconSize + 2,
        size: iconSizeSM - 4,
        radius: 3,
        stroke: data ? staticWhite : interactionLineColorCommon,
        fill: data ? iconBgSelected : undefined,
        isChecked: data,
      });
    }

    if (isMultiple && Array.isArray(data)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();

      let startX = x + cellHorizontalPadding;
      const startY = y + height / 2 - halfIconSize;
      data.forEach((check) => {
        if (check) {
          drawCheckbox(ctx, {
            x: startX,
            y: startY,
            size: iconSizeSM,
            stroke: staticWhite,
            fill: iconBgSelected,
            isChecked: true,
          });
          startX += iconSizeSM + cellHorizontalPadding / 2;
        }
      });

      ctx.restore();
    }
  },
  checkRegion: (cell: IBooleanCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { data, readonly } = cell;
    if (readonly) return { type: CellRegionType.Blank };
    const { hoverCellPosition, width, height, theme } = props;
    const [x, y] = hoverCellPosition;
    const { iconSizeSM } = theme;
    const halfIconSize = iconSizeSM / 2;

    if (
      inRange(x, width / 2 - halfIconSize, width / 2 + halfIconSize) &&
      inRange(y, height / 2 - halfIconSize, height / 2 + halfIconSize)
    ) {
      return {
        type: CellRegionType.Update,
        data: !data || null,
      };
    }
    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IBooleanCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = booleanCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion || cellRegion.type === CellRegionType.Blank) return;
    callback(cellRegion);
  },
};
