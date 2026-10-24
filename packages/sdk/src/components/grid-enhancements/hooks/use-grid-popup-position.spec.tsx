import { renderHook } from '@testing-library/react';
import { GRID_CONTAINER_ATTR } from '../../grid/configs';
import { useGridPopupPosition } from './use-grid-popup-position';

describe('useGridPopupPosition', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('measures the space above from the viewport, not from the grid', () => {
    const grid = document.createElement('div');
    grid.setAttribute(GRID_CONTAINER_ATTR, '');
    grid.getBoundingClientRect = () => ({ y: 300 }) as DOMRect;
    const editor = document.createElement('div');
    editor.id = 'editor';
    grid.appendChild(editor);
    document.body.appendChild(grid);
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });

    // cell top is 300 + 250 = 550px from the viewport top, 1000 - 550 - 30 = 420px below
    const { result } = renderHook(() =>
      useGridPopupPosition({ x: 0, y: 250, width: 100, height: 30, editorId: 'editor' })
    );

    expect(result.current).toEqual({ top: 'unset', bottom: 30, maxHeight: 550 - 32 });
  });
});
