import { TimeFormatting } from '@teable/core';
import type { IDateFieldOptions } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../../context';
import type { IAppContext } from '../../../context';
import { DateEditorMain } from './EditorMain';

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const tokyoOptions = {
  formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.Hour24, timeZone: 'Asia/Tokyo' },
} as IDateFieldOptions;

describe('DateEditorMain', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('picks the current moment in the field timezone for "today" when empty', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Mar 3 03:30 in Tokyo, still Mar 2 in UTC and the Americas
    vi.setSystemTime(new Date('2024-03-02T18:30:00.000Z'));
    const onChange = vi.fn();

    render(
      <AppContext.Provider value={{ lang: 'en' } as IAppContext}>
        <DateEditorMain value={null} options={tokyoOptions} onChange={onChange} />
      </AppContext.Provider>
    );
    fireEvent.click(screen.getByText('editor.date.today'));

    expect(onChange).toHaveBeenCalledWith('2024-03-02T18:30:00.000Z');
  });

  it('keeps the existing time of day for "today"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-03-02T18:30:00.000Z'));
    const onChange = vi.fn();

    render(
      <AppContext.Provider value={{ lang: 'en' } as IAppContext}>
        {/* Jan 5 20:00 in Tokyo */}
        <DateEditorMain
          value="2024-01-05T11:00:00.000Z"
          options={tokyoOptions}
          onChange={onChange}
        />
      </AppContext.Provider>
    );
    fireEvent.click(screen.getByText('editor.date.today'));

    // Mar 3 20:00 in Tokyo
    expect(onChange).toHaveBeenCalledWith('2024-03-03T11:00:00.000Z');
  });
});
