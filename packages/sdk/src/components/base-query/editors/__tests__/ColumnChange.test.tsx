import { CellValueType, FieldType, SortFunc } from '@teable/core';
import type { IBaseQueryColumn } from '@teable/openapi';
import { BaseQueryColumnType } from '@teable/openapi';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppContext } from '../../../../context/__tests__/createAppContext';
import { BaseFilterContext } from '../../../filter/context';
import { QueryEditorProvider } from '../../context/QueryEditorProvider';
import { FieldComponent } from '../QueryFilter/FieldComponent';
import { QueryGroup } from '../QueryGroup';
import { QueryOrder } from '../QueryOrder';

vi.mock('../../common/ContextColumnSelector', () => ({
  ContextColumnSelector: (props: {
    onChange: (value: string, type: BaseQueryColumnType) => void;
  }) => (
    <div>
      <button onClick={() => props.onChange('fldText', BaseQueryColumnType.Field)}>
        pick-text
      </button>
      <button onClick={() => props.onChange('fldNum_sum', BaseQueryColumnType.Aggregation)}>
        pick-aggregation
      </button>
    </div>
  ),
}));

const columns = {
  from: [
    {
      column: 'fldNum',
      name: 'Num',
      type: BaseQueryColumnType.Field,
      fieldSource: { id: 'fldNum', type: FieldType.Number, cellValueType: CellValueType.Number },
    },
    {
      column: 'fldText',
      name: 'Text',
      type: BaseQueryColumnType.Field,
      fieldSource: {
        id: 'fldText',
        type: FieldType.SingleLineText,
        cellValueType: CellValueType.String,
      },
    },
  ] as IBaseQueryColumn[],
  join: [],
};

const renderWithColumns = (ui: React.ReactElement) => {
  const AppContext = createAppContext();
  return render(
    <AppContext>
      <QueryEditorProvider columns={columns}>{ui}</QueryEditorProvider>
    </AppContext>
  );
};

describe('base query column change', () => {
  it('filter resets operator and value when the column changes', () => {
    const onChange = vi.fn();
    const item = {
      field: 'fldNum',
      type: BaseQueryColumnType.Field,
      operator: 'isGreater' as const,
      value: 5,
    };
    renderWithColumns(
      <BaseFilterContext.Provider value={{ onChange } as never}>
        <FieldComponent path={['children', 0, 'field']} value={item.field} item={item} />
      </BaseFilterContext.Provider>
    );

    fireEvent.click(screen.getByText('pick-text'));
    expect(onChange).toHaveBeenCalledWith(['children', 0], {
      field: 'fldText',
      type: BaseQueryColumnType.Field,
      operator: 'is',
      value: null,
    });
  });

  it('group by keeps the column type of the selected column', () => {
    const onChange = vi.fn();
    renderWithColumns(
      <QueryGroup
        value={[{ column: 'fldNum', type: BaseQueryColumnType.Field }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByText('pick-aggregation')[0]);
    expect(onChange).toHaveBeenCalledWith([
      { column: 'fldNum_sum', type: BaseQueryColumnType.Aggregation },
    ]);
  });

  it('order by keeps the column type of the selected column', () => {
    const onChange = vi.fn();
    renderWithColumns(
      <QueryOrder
        value={[{ column: 'fldNum', type: BaseQueryColumnType.Field, order: SortFunc.Asc }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByText('pick-aggregation')[0]);
    expect(onChange).toHaveBeenCalledWith([
      { column: 'fldNum_sum', type: BaseQueryColumnType.Aggregation, order: SortFunc.Asc },
    ]);
  });
});
