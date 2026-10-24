import type { ITimeZoneString } from '@teable/core';
import { TimeFormatting } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppContext } from '../../../../../../context/__tests__/createAppContext';
import { defaultLocale } from '../../../../../../context/app/i18n';
import { DateRangePicker } from '../DateRangePicker';

globalThis.ResizeObserver =
  globalThis.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

describe('DateRangePicker', () => {
  it('confirming without edits keeps the saved range when the field timezone changed', () => {
    const onChange = vi.fn();
    // saved in Tokyo: 2024-01-10 10:00 ~ 2024-01-12 23:59
    const value = {
      exactDate: '2024-01-10T01:00:00.000Z',
      exactDateEnd: '2024-01-12T14:59:59.999Z',
      timeZone: 'Asia/Tokyo' as ITimeZoneString,
    };
    render(
      <DateRangePicker
        value={value}
        onChange={onChange}
        options={{
          formatting: {
            date: 'YYYY-MM-DD',
            time: TimeFormatting.Hour24,
            timeZone: 'America/New_York',
          },
        }}
      />,
      { wrapper: createAppContext() }
    );

    // the input shows the saved timezone's wall time
    fireEvent.click(screen.getByDisplayValue('2024-01-10 10:00 ~ 2024-01-12 23:59'));
    fireEvent.click(screen.getByText(defaultLocale.common.confirm));

    expect(onChange).toHaveBeenCalledWith(value);
  });
});
