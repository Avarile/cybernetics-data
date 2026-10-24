import { NumberFormattingType } from '@cybernetics/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberEditor } from './Editor';

describe('NumberEditor', () => {
  it.each([1e-7, -2.5e-10, 1e21, 1.5e22])(
    'round-trips %d on blur without exponent loss',
    (value) => {
      const onChange = vi.fn();
      render(<NumberEditor value={value} onChange={onChange} />);

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).not.toMatch(/e/i);
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith(value);
    }
  );

  it('shows and saves percent values scaled by 100', () => {
    const onChange = vi.fn();
    render(
      <NumberEditor
        value={0.25}
        formatting={{ type: NumberFormattingType.Percent, precision: 2 }}
        onChange={onChange}
      />
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('25');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(0.3);
  });
});
