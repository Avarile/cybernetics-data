import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { IMouseState } from '../interface';
import { LinearRowType, RegionType, SelectableType, SelectionRegionType } from '../interface';
import { CoordinateManager } from '../managers';
import { useSelection } from './useSelection';

const coordInstance = new CoordinateManager({
  rowCount: 10,
  pureRowCount: 10,
  columnCount: 5,
  containerWidth: 500,
  containerHeight: 500,
  rowHeight: 30,
  columnWidth: 100,
});

const click = { shiftKey: false, metaKey: false } as React.MouseEvent<HTMLDivElement, MouseEvent>;
const cellAt = (columnIndex: number): IMouseState => ({
  x: 0,
  y: 0,
  rowIndex: 1,
  columnIndex,
  type: RegionType.Cell,
  isOutOfBounds: false,
});

const renderSelection = (isMultiSelectionEnable: boolean) =>
  renderHook(() =>
    useSelection({
      coordInstance,
      selectable: SelectableType.Column,
      isMultiSelectionEnable,
      getLinearRow: (index) => ({
        type: LinearRowType.Row,
        displayIndex: index + 1,
        realIndex: index,
      }),
      setActiveCell: vi.fn(),
      onSelectionChanged: undefined,
    })
  );

describe('useSelection with selectable=Column', () => {
  it('toggles a column off when it is clicked again', () => {
    const { result } = renderSelection(false);

    act(() => result.current.onSelectionClick(click, cellAt(2)));
    expect(result.current.selection.ranges).toEqual([[2, 2]]);

    act(() => result.current.onSelectionClick(click, cellAt(2)));
    expect(result.current.selection.type).toBe(SelectionRegionType.None);
  });

  it('adds columns to the selection when multi-selection is enabled', () => {
    const { result } = renderSelection(true);

    act(() => result.current.onSelectionClick(click, cellAt(1)));
    act(() => result.current.onSelectionClick(click, cellAt(3)));

    expect(result.current.selection.type).toBe(SelectionRegionType.Columns);
    expect(result.current.selection.ranges).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });
});
