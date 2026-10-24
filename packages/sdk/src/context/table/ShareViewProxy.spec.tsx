/* eslint-disable @typescript-eslint/no-explicit-any */
import { ViewType } from '@teable/core';
import { act, render } from '@testing-library/react';
import { useContext } from 'react';
import { vi } from 'vitest';
import { ViewContext } from '../view/ViewContext';
import { ShareViewProxy } from './ShareViewProxy';

const mockView = vi.hoisted(() => ({ current: undefined as any }));

vi.mock('../../hooks/use-view', () => ({ useView: () => mockView.current }));

const createServerView = (data: Record<string, unknown>) => {
  const viewData = {
    id: 'viwShare',
    name: 'Grid',
    type: ViewType.Grid,
    columnMeta: {},
    options: { rowHeight: 'short' },
    ...data,
  };
  return { id: viewData.id, doc: { data: viewData } };
};

describe('ShareViewProxy', () => {
  it('applies owner changes to keys the viewer has not changed locally', () => {
    let proxyView: any;
    const Consumer = () => {
      proxyView = useContext(ViewContext).views[0];
      return null;
    };
    const localFilter = { conjunction: 'and', filterSet: [] };

    mockView.current = createServerView({});
    const { rerender } = render(
      <ShareViewProxy>
        <Consumer />
      </ShareViewProxy>
    );
    act(() => proxyView.updateFilter(localFilter));

    mockView.current = createServerView({ options: { rowHeight: 'tall' } });
    rerender(
      <ShareViewProxy>
        <Consumer />
      </ShareViewProxy>
    );

    expect(proxyView.options).toEqual({ rowHeight: 'tall' });
    expect(proxyView.filter).toEqual(localFilter);
  });

  it('keeps the viewer local options once they have been changed', () => {
    let proxyView: any;
    const Consumer = () => {
      proxyView = useContext(ViewContext).views[0];
      return null;
    };

    mockView.current = createServerView({});
    const { rerender } = render(
      <ShareViewProxy>
        <Consumer />
      </ShareViewProxy>
    );
    act(() => proxyView.updateOption({ rowHeight: 'medium' }));

    mockView.current = createServerView({ options: { rowHeight: 'tall' } });
    rerender(
      <ShareViewProxy>
        <Consumer />
      </ShareViewProxy>
    );

    expect(proxyView.options).toEqual({ rowHeight: 'medium' });
  });
});
