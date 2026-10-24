import { useRef, useState } from 'react';
import { DEFAULT_DRAG_STATE } from '../configs';
import type { IDragState, ILinearRow, IMouseState, IRange, IScrollState } from '../interface';
import { DragRegionType, RegionType, DraggableType } from '../interface';
import type { CoordinateManager, CombinedSelection } from '../managers';
import { inRange } from '../utils';

export const getDropTargetIndex = (
  coordInstance: CoordinateManager,
  mouseState: IMouseState,
  scrollState: IScrollState,
  dragType: DragRegionType
) => {
  const { x, y } = mouseState;
  const { scrollLeft, scrollTop } = scrollState;
  const { freezeRegionWidth, rowInitSize } = coordInstance;

  if (dragType === DragRegionType.Columns) {
    const offsetX = x <= freezeRegionWidth ? x : scrollLeft + x;
    const hoverColumnIndex = coordInstance.getColumnStartIndex(offsetX);
    const hoverColumnOffsetX = coordInstance.getColumnOffset(hoverColumnIndex);
    const hoverColumnWidth = coordInstance.getColumnWidth(hoverColumnIndex);
    return inRange(offsetX, hoverColumnOffsetX, hoverColumnOffsetX + hoverColumnWidth / 2)
      ? hoverColumnIndex
      : hoverColumnIndex + 1;
  }
  if (dragType === DragRegionType.Rows) {
    const offsetY = y <= rowInitSize ? y : scrollTop + y;
    const hoverRowIndex = coordInstance.getRowStartIndex(offsetY);
    const hoverRowOffsetY = coordInstance.getRowOffset(hoverRowIndex);
    const hoverRowHeight = coordInstance.getRowHeight(hoverRowIndex);
    return inRange(offsetY, hoverRowOffsetY, hoverRowOffsetY + hoverRowHeight / 2)
      ? hoverRowIndex
      : hoverRowIndex + 1;
  }
  return -Infinity;
};

// Row drag ranges hold real (record) indices, like row selection ranges
const getRowDragRanges = (selection: CombinedSelection, realRowIndex: number): IRange[] => {
  const { isRowSelection, ranges } = selection;
  return isRowSelection && selection.includes([realRowIndex, realRowIndex])
    ? ranges
    : [[realRowIndex, realRowIndex]];
};

export const useDrag = (
  coordInstance: CoordinateManager,
  scrollState: IScrollState,
  selection: CombinedSelection,
  getLinearRow: (index: number) => ILinearRow,
  real2RowIndex: (index: number) => number,
  draggable?: DraggableType
) => {
  // Prevents Drag and Drop from Being Too Reactive
  const startPosition = useRef(0);
  const [dragState, setDragState] = useState<IDragState>(DEFAULT_DRAG_STATE);
  const { scrollTop, scrollLeft } = scrollState;

  const onDragStart = (
    mouseState: IMouseState,
    onEnd: (type: DragRegionType, dragIndexs: IRange[]) => void
  ) => {
    if (draggable === DraggableType.None) return;

    const { type, rowIndex: hoverRowIndex, columnIndex: hoverColumnIndex, x, y } = mouseState;
    const { isColumnSelection, ranges: selectionRanges } = selection;

    if (type === RegionType.RowHeaderDragHandler && draggable !== DraggableType.Column) {
      startPosition.current = y;
      const ranges = getRowDragRanges(selection, getLinearRow(hoverRowIndex).realIndex);
      onEnd(DragRegionType.Rows, ranges);
      setDragState({
        type: DragRegionType.Rows,
        ranges,
        delta: y + scrollTop - coordInstance.getRowOffset(hoverRowIndex),
        isDragging: false,
      });
    }

    if (type === RegionType.ColumnHeader && draggable !== DraggableType.Row) {
      startPosition.current = x;
      const ranges =
        isColumnSelection && selection.includes([hoverColumnIndex, hoverColumnIndex])
          ? selectionRanges
          : ([[hoverColumnIndex, hoverColumnIndex]] as IRange[]);
      onEnd(DragRegionType.Columns, ranges);
      setDragState({
        type: DragRegionType.Columns,
        ranges,
        delta: x - coordInstance.getColumnRelativeOffset(hoverColumnIndex, scrollLeft),
        isDragging: false,
      });
    }
  };

  const onDragChange = (mouseState: IMouseState) => {
    const { type, isDragging } = dragState;
    if (isDragging) return;
    if (![DragRegionType.Rows, DragRegionType.Columns].includes(type)) return;

    const { x, y } = mouseState;
    const prevPosition = type === DragRegionType.Rows ? y : x;
    const moveDistance = Math.abs(prevPosition - startPosition.current);
    if (moveDistance < 5) return;

    setDragState((prev) => ({ ...prev, isDragging: true }));
  };

  const onDragEnd = (
    mouseState: IMouseState,
    onEnd: (dragIndexs: IRange[], dropIndex: number) => void
  ) => {
    const { type, isDragging } = dragState;

    if (!isDragging || !onEnd) return setDragState(DEFAULT_DRAG_STATE);

    if ([DragRegionType.Columns, DragRegionType.Rows].includes(type)) {
      const { ranges } = dragState;
      const targetIndex = getDropTargetIndex(coordInstance, mouseState, scrollState, type);
      const startIndex = ranges[0][0];
      const endIndex = ranges[ranges.length - 1][1];
      // The drop target is linear, row drag ranges are real
      const isRows = type === DragRegionType.Rows;
      if (
        !inRange(
          targetIndex,
          isRows ? real2RowIndex(startIndex) : startIndex,
          isRows ? real2RowIndex(endIndex) : endIndex
        )
      ) {
        onEnd(ranges, targetIndex);
      }
    }
    setDragState(DEFAULT_DRAG_STATE);
  };

  return {
    dragState,
    setDragState,
    onDragStart,
    onDragChange,
    onDragEnd,
  };
};
