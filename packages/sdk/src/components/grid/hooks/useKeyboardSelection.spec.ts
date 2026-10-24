import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ICellItem } from '../interface';
import { SelectionRegionType } from '../interface';
import { CombinedSelection, CoordinateManager } from '../managers';
import { getNavigationRanges, useKeyboardSelection } from './useKeyboardSelection';

const coordInstance = new CoordinateManager({
  rowCount: 10,
  pureRowCount: 10,
  columnCount: 5,
  containerWidth: 500,
  containerHeight: 500,
  rowHeight: 30,
  columnWidth: 100,
  rowInitSize: 40,
  columnInitSize: 40,
});

describe('getNavigationRanges', () => {
  it('keeps the ranges of a cell selection', () => {
    const selection = new CombinedSelection(SelectionRegionType.Cells, [
      [1, 1],
      [2, 3],
    ]);
    expect(getNavigationRanges(selection, [1, 1])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });

  it('starts from the active cell for a column selection', () => {
    const selection = new CombinedSelection(SelectionRegionType.Columns, [[3, 3]]);
    expect(getNavigationRanges(selection, [3, 0])).toEqual([
      [3, 0],
      [3, 0],
    ]);
  });
});

describe('useKeyboardSelection', () => {
  const renderKeyboard = (selection: CombinedSelection, activeCell: ICellItem) => {
    const setSelection = vi.fn();
    const setActiveCell = vi.fn();
    renderHook(() =>
      useKeyboardSelection({
        isEditing: false,
        activeCell,
        coordInstance,
        selection,
        scrollToItem: vi.fn(),
        scrollBy: vi.fn(),
        setEditing: vi.fn(),
        setActiveCell,
        setSelection,
        editorRef: { current: null },
      })
    );
    return { setSelection, setActiveCell };
  };

  const pressKey = (key: string, code: string) => {
    fireEvent.keyDown(document, { key, code });
    fireEvent.keyUp(document, { key, code });
  };

  it('moves down from the active cell as a cell selection after a column header click', () => {
    // clicking column header 3 selects column 3 and activates [3, 0]
    const selection = new CombinedSelection(SelectionRegionType.Columns, [[3, 3]]);
    const { setSelection, setActiveCell } = renderKeyboard(selection, [3, 0]);

    pressKey('ArrowDown', 'ArrowDown');

    expect(setActiveCell).toHaveBeenCalledWith([3, 1]);
    const newSelection = setSelection.mock.calls[0][0] as CombinedSelection;
    expect(newSelection.type).toBe(SelectionRegionType.Cells);
    expect(newSelection.ranges).toEqual([
      [3, 1],
      [3, 1],
    ]);
  });

  it('tabs to the next cell from the active cell of a column selection', () => {
    const selection = new CombinedSelection(SelectionRegionType.Columns, [[3, 3]]);
    const { setSelection, setActiveCell } = renderKeyboard(selection, [3, 0]);

    pressKey('Tab', 'Tab');

    expect(setActiveCell).toHaveBeenCalledWith([4, 0]);
    const newSelection = setSelection.mock.calls[0][0] as CombinedSelection;
    expect(newSelection.type).toBe(SelectionRegionType.Cells);
    expect(newSelection.ranges).toEqual([
      [4, 0],
      [4, 0],
    ]);
  });
});
