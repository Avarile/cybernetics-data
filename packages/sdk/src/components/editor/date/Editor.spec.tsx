import { TimeFormatting } from '@teable/core';
import type { IDateFieldOptions } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../../context';
import type { IAppContext } from '../../../context';
import { DateEditor } from './Editor';

vi.mock('../../../hooks', () => ({
  useIsTouchDevice: () => false,
}));

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const options = {
  formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.None, timeZone: 'UTC' },
} as IDateFieldOptions;

const renderWithApp = (ui: ReactElement) =>
  render(<AppContext.Provider value={{ lang: 'en' } as IAppContext}>{ui}</AppContext.Provider>);

const typeAndBlur = (text: string) => {
  const input = screen.getAllByRole('textbox')[0] as HTMLInputElement;
  fireEvent.click(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  return input;
};

describe('DateEditor', () => {
  it('keeps the previous date when the typed input cannot be parsed', () => {
    const onChange = vi.fn();
    renderWithApp(
      <DateEditor value="2024-01-05T10:00:00.000Z" options={options} onChange={onChange} />
    );

    const input = typeAndBlur('not a date');

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('2024-01-05');
  });

  it('clears the date when the input is emptied', () => {
    const onChange = vi.fn();
    renderWithApp(
      <DateEditor value="2024-01-05T10:00:00.000Z" options={options} onChange={onChange} />
    );

    typeAndBlur('');

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
