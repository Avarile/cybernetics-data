import type * as Openapi from '@teable/openapi';
import type { IBaseQuery, IBaseQueryColumn } from '@teable/openapi';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { vi } from 'vitest';
import type { IBaseQueryBuilderRef } from '../QueryBuilder';
import { BaseQueryBuilder } from '../QueryBuilder';

const { getFieldsMock } = vi.hoisted(() => ({ getFieldsMock: vi.fn() }));

vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof Openapi>()),
  getFields: getFieldsMock,
}));

// render only the context plumbing, the editors are not under test here
vi.mock('../context/QueryEditorProvider', () => ({
  QueryEditorProvider: (props: { columns: { from: IBaseQueryColumn[] } }) => (
    <pre data-testid="from-columns">{props.columns.from.map((c) => c.column).join(',')}</pre>
  ),
}));
vi.mock('../query-from/QueryFrom', () => ({
  QueryFrom: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock('../query-from/QueryFromValue', () => ({
  QueryFromTableValue: (props: { component?: React.ReactNode }) => <>{props.component}</>,
}));

const fieldsOf = (tableId: string) => [
  { id: `${tableId}_fld`, name: `${tableId} field`, type: 'number', cellValueType: 'number' },
];

const lastFromColumns = () => screen.getAllByTestId('from-columns').at(-1)?.textContent;

describe('BaseQueryBuilder context', () => {
  beforeEach(() => {
    getFieldsMock.mockReset();
  });

  it('keeps aggregation columns of a sub query on first load', async () => {
    getFieldsMock.mockImplementation((tableId: string) =>
      Promise.resolve({ data: fieldsOf(tableId) })
    );
    const query = {
      from: {
        from: 'tblA',
        aggregation: [{ column: 'tblA_fld', statisticFunc: 'sum' }],
      },
    } as IBaseQuery;
    const ref = createRef<IBaseQueryBuilderRef>();
    render(<BaseQueryBuilder ref={ref} query={query} onChange={vi.fn()} />);

    await act(async () => {
      ref.current?.initContext();
    });

    await waitFor(() => expect(lastFromColumns()).toContain('tblA_fld_sum'));
  });

  it('ignores a stale from table response', async () => {
    const resolvers: Record<string, () => void> = {};
    getFieldsMock.mockImplementation(
      (tableId: string) =>
        new Promise((resolve) => {
          resolvers[tableId] = () => resolve({ data: fieldsOf(tableId) });
        })
    );
    const ref = createRef<IBaseQueryBuilderRef>();
    const { rerender } = render(
      <BaseQueryBuilder ref={ref} query={{ from: 'tblA' }} onChange={vi.fn()} />
    );
    act(() => ref.current?.initContext());

    rerender(<BaseQueryBuilder ref={ref} query={{ from: 'tblB' }} onChange={vi.fn()} />);
    act(() => ref.current?.initContext());

    await act(async () => resolvers.tblB());
    await act(async () => resolvers.tblA());

    expect(lastFromColumns()).toBe('tblB_fld');
  });
});
