import { CellValueType, FieldType, TimeFormatting } from '@cybernetics/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IFieldInstance } from '../../model';
import { CellValue } from './CellValue';

const createField = (field: Partial<IFieldInstance>) =>
  ({ options: {}, isLookup: true, ...field }) as IFieldInstance;

describe('CellValue multi-value rendering', () => {
  it('formats each date of a lookup value', () => {
    const field = createField({
      type: FieldType.Date,
      cellValueType: CellValueType.DateTime,
      options: {
        formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.None, timeZone: 'UTC' },
      },
    });

    render(
      <CellValue field={field} value={['2024-01-02T00:00:00.000Z', '2024-03-04T00:00:00.000Z']} />
    );

    expect(screen.getByText('2024-01-02, 2024-03-04')).toBeInTheDocument();
  });

  it('joins the items of a single line text lookup value', () => {
    const field = createField({
      type: FieldType.SingleLineText,
      cellValueType: CellValueType.String,
    });

    render(<CellValue field={field} value={['Alice', 'Bob']} />);

    expect(screen.getByText('Alice, Bob')).toBeInTheDocument();
  });

  it('joins the items of a multi-value text formula', () => {
    const field = createField({
      type: FieldType.Formula,
      cellValueType: CellValueType.String,
      isLookup: false,
    });

    render(<CellValue field={field} value={['Alice', 'Bob']} />);

    expect(screen.getByText('Alice, Bob')).toBeInTheDocument();
  });
});
