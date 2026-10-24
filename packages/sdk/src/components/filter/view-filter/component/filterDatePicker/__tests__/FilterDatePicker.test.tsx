import type { IDateFilter } from '@cybernetics/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppContext } from '../../../../../../context/__tests__/createAppContext';
import { defaultLocale } from '../../../../../../context/app/i18n';
import type { DateField } from '../../../../../../model';
import { FilterDatePicker } from '../FilterDatePicker';

const field = { options: {} } as unknown as DateField;
const timeZone = 'UTC' as IDateFilter['timeZone'];
const daysAgo = (numberOfDays: number): IDateFilter => ({
  mode: 'daysAgo',
  numberOfDays,
  timeZone,
});

const getDaysInput = () =>
  screen.getByPlaceholderText(defaultLocale.filter.default.placeholder) as HTMLInputElement;

describe('FilterDatePicker days input', () => {
  it('reflects value changes from props (row reuse after delete, remote updates)', () => {
    const { rerender } = render(
      <FilterDatePicker value={daysAgo(3)} field={field} operator="is" onSelect={vi.fn()} />,
      { wrapper: createAppContext() }
    );
    expect(getDaysInput().value).toBe('3');

    rerender(
      <FilterDatePicker value={daysAgo(7)} field={field} operator="is" onSelect={vi.fn()} />
    );
    expect(getDaysInput().value).toBe('7');
  });

  it('emits the typed number and strips non digits', () => {
    const onSelect = vi.fn();
    render(
      <FilterDatePicker value={daysAgo(3)} field={field} operator="is" onSelect={onSelect} />,
      {
        wrapper: createAppContext(),
      }
    );

    fireEvent.change(getDaysInput(), { target: { value: '12a' } });
    expect(onSelect).toHaveBeenLastCalledWith(daysAgo(12));
    expect(getDaysInput().value).toBe('12');
  });

  it('clears the filter value when the input is emptied but keeps the mode', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <FilterDatePicker value={daysAgo(3)} field={field} operator="is" onSelect={onSelect} />,
      { wrapper: createAppContext() }
    );

    fireEvent.change(getDaysInput(), { target: { value: '' } });
    expect(onSelect).toHaveBeenLastCalledWith(null);

    // parent echoes the cleared value back
    rerender(<FilterDatePicker value={null} field={field} operator="is" onSelect={onSelect} />);
    expect(getDaysInput().value).toBe('');

    fireEvent.change(getDaysInput(), { target: { value: '5' } });
    expect(onSelect).toHaveBeenLastCalledWith(daysAgo(5));
  });

  it('switching to a days mode without a number clears the stale value and keeps the mode', () => {
    const onSelect = vi.fn();
    const today: IDateFilter = { mode: 'today', timeZone };
    const { rerender } = render(
      <FilterDatePicker value={today} field={field} operator="is" onSelect={onSelect} />,
      { wrapper: createAppContext() }
    );

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText(defaultLocale.filter.component.date.daysAgo));
    expect(onSelect).toHaveBeenLastCalledWith(null);

    // parent echoes the cleared value back
    rerender(<FilterDatePicker value={null} field={field} operator="is" onSelect={onSelect} />);
    expect(getDaysInput().value).toBe('');
  });
});
