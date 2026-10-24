import type { IFilter } from '@teable/core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalFilterSync } from './useLocalFilterSync';

const makeFilter = (fieldId: string, conjunction: 'and' | 'or' = 'and'): IFilter => ({
  conjunction,
  filterSet: [{ fieldId, operator: 'is', value: 'x' }],
});

const filterA = makeFilter('fldA');
const filterB = makeFilter('fldB');

type IProps = { filters: IFilter; resetKey?: string };

const setup = (initial: IProps) => {
  const onChange = vi.fn();
  const hook = renderHook(
    ({ filters, resetKey }: IProps) => useLocalFilterSync(filters, onChange, resetKey),
    { initialProps: initial }
  );
  return { ...hook, onChange };
};

describe('useLocalFilterSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends local edits after the debounce', () => {
    const { result, onChange } = setup({ filters: filterA });

    act(() => result.current[1](filterB));
    act(() => vi.advanceTimersByTime(300));

    expect(onChange).toHaveBeenCalledWith(filterB);
  });

  it('accepts server updates after an edit that left the filter unchanged', () => {
    const { result, rerender, onChange } = setup({ filters: filterA });

    // Re-picking the current conjunction produces an equal filter.
    act(() => result.current[1](makeFilter('fldA')));
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).not.toHaveBeenCalled();

    // A collaborator changes the filter.
    rerender({ filters: filterB });

    expect(result.current[0]).toEqual(filterB);
  });

  it('drops pending edits from the previous view instead of sending them to the new one', () => {
    const { result, rerender, onChange } = setup({ filters: filterA, resetKey: 'viwA' });

    act(() => result.current[1](makeFilter('fldA', 'or')));
    // Switch views before the debounce fires.
    rerender({ filters: filterB, resetKey: 'viwB' });
    act(() => vi.advanceTimersByTime(300));

    expect(onChange).not.toHaveBeenCalled();
    expect(result.current[0]).toEqual(filterB);
  });
});
