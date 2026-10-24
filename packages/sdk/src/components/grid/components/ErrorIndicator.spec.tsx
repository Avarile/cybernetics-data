import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../../../context/app/AppContext';
import type { IAppContext } from '../../../context/app/AppContext';
import { CoordinateManager } from '../managers';
import { ErrorIndicator } from './ErrorIndicator';

// Grouped view: linear 0 is a group header, records 0-1 are linear 1-2
const coordInstance = new CoordinateManager({
  rowCount: 3,
  pureRowCount: 2,
  columnCount: 2,
  containerWidth: 500,
  containerHeight: 500,
  rowHeight: 30,
  columnWidth: 100,
  rowHeightMap: { 0: 50 },
  rowInitSize: 40,
  columnInitSize: 40,
});
const real2RowIndex = (index: number) => ({ 0: 1, 1: 2 })[index] as number;
const locale = { aiError: { title: 'Error', retry: 'Retry', dismiss: 'Dismiss' } };

describe('ErrorIndicator', () => {
  it('positions the error at the linear row of the real record index', () => {
    const { container } = render(
      <AppContext.Provider value={{ locale, lang: 'en' } as unknown as IAppContext}>
        <ErrorIndicator
          cellErrors={[{ cellItem: [1, 1], errorMsg: 'failed' }]}
          coordInstance={coordInstance}
          scrollState={{ scrollTop: 0, scrollLeft: 0, isScrolling: false }}
          real2RowIndex={real2RowIndex}
        />
      </AppContext.Provider>
    );

    const indicator = container.querySelector<HTMLElement>('.pointer-events-none > .absolute');
    // record 1 is linear 2: 40 (header) + 50 (group) + 30 (record 0)
    expect(indicator?.style.top).toBe(`${coordInstance.getRowOffset(2)}px`);
    expect(indicator?.style.top).toBe('120px');
  });
});
