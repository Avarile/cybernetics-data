import { GRID_DEFAULT } from '../../configs';
import type { IGridTheme } from '../../configs';
import { mixColor, TAG_HUES } from '../../utils';
import type { ITagHue } from '../../utils';
import { drawMultiLineText, drawRect, drawSingleLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ITextCell,
  ICellRenderProps,
  ICellMeasureProps,
} from './interface';

const { maxRowCount, cellHorizontalPadding, cellVerticalPaddingMD, cellTextLineHeight } =
  GRID_DEFAULT;

const AVATAR_SIZE = 14;
const AVATAR_GAP = 6;
const AVATAR_OFFSET = AVATAR_SIZE + AVATAR_GAP;
const AVATAR_HUES = (Object.keys(TAG_HUES) as ITagHue[]).filter((hue) => hue !== 'gray');

const hueFor = (text: string) => {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAG_HUES[AVATAR_HUES[hash % AVATAR_HUES.length]];
};

/** Rounded-square avatar with the first letter, tinted from the text (design §6.4). */
const drawAvatar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  theme: IGridTheme
) => {
  const { cellBg, cellTextColor, fontFamily } = theme;
  const hue = hueFor(text);
  drawRect(ctx, {
    x,
    y,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    radius: 3,
    fill: mixColor(hue, cellBg, 0.24),
  });
  const letter = (text.trim()[0] ?? '').toUpperCase();
  if (!letter) return;
  ctx.save();
  ctx.font = `600 9px ${fontFamily}`;
  drawSingleLineText(ctx, {
    x: x + AVATAR_SIZE / 2,
    y: y + (AVATAR_SIZE - 9) / 2 + 0.5,
    text: letter,
    textAlign: 'center',
    fontSize: 9,
    fill: mixColor(hue, cellTextColor, 0.7),
  });
  ctx.restore();
};

export const textCellRenderer: IInternalCellRenderer<ITextCell> = {
  type: CellType.Text,
  measure: (cell: ITextCell, props: ICellMeasureProps) => {
    const { displayData, avatar } = cell;
    const { ctx, theme, width, height } = props;
    const { cellTextColor, fontSizeSM, fontFamily } = theme;

    if (!displayData) {
      return { width, height, totalHeight: height };
    }

    ctx.font = `${fontSizeSM}px ${fontFamily}`;

    const lineCount = drawMultiLineText(ctx, {
      text: displayData,
      maxLines: Infinity,
      lineHeight: cellTextLineHeight,
      maxWidth: width - cellHorizontalPadding * 2 - (avatar ? AVATAR_OFFSET : 0),
      fill: cellTextColor,
      needRender: false,
    }).length;

    const totalHeight = cellVerticalPaddingMD + lineCount * cellTextLineHeight;
    const displayRowCount = Math.min(maxRowCount, lineCount);

    return {
      width,
      height: Math.max(height, cellVerticalPaddingMD + displayRowCount * cellTextLineHeight),
      totalHeight,
    };
  },
  draw: (cell: ITextCell, props: ICellRenderProps) => {
    const { displayData, avatar } = cell;
    const { ctx, rect, theme, isActive } = props;
    const { x, y, width, height } = rect;

    if (!displayData) return;

    const { cellTextColor, fontSizeSM, fontFamily } = theme;
    const renderHeight = height - cellVerticalPaddingMD;
    const textOffset = avatar ? AVATAR_OFFSET : 0;

    if (avatar) {
      drawAvatar(ctx, x + cellHorizontalPadding, y + cellVerticalPaddingMD - 1, displayData, theme);
      ctx.font = `${fontSizeSM}px ${fontFamily}`;
    }

    drawMultiLineText(ctx, {
      x: x + cellHorizontalPadding + textOffset,
      y: y + cellVerticalPaddingMD,
      text: displayData,
      maxLines: isActive ? Infinity : Math.max(Math.floor(renderHeight / cellTextLineHeight), 1),
      lineHeight: cellTextLineHeight,
      maxWidth: width - cellHorizontalPadding * 2 - textOffset,
      fill: cellTextColor,
    });
  },
};
