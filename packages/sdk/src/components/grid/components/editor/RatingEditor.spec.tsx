import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IRatingCell } from '../../renderers';
import { CellType } from '../../renderers';
import { RatingEditor } from './RatingEditor';

const renderRating = (max: number) => {
  const onChange = vi.fn();
  const cell = { type: CellType.Rating, data: 0, icon: 'star', color: 'yellow', max };
  const { container } = render(
    <RatingEditor
      cell={cell as IRatingCell}
      rect={{ x: 0, y: 0, width: 100, height: 30, editorId: 'rating' }}
      theme={{} as never}
      onChange={onChange}
    />
  );
  const target = container.firstChild as HTMLElement;
  const press = (digit: number) =>
    fireEvent.keyDown(target, { key: String(digit), keyCode: 48 + digit });
  return { onChange, press };
};

describe('RatingEditor', () => {
  it('types 10 with "1" then "0" when the rating allows it', () => {
    const { onChange, press } = renderRating(10);
    press(1);
    press(0);
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('never saves more than max', () => {
    const { onChange, press } = renderRating(5);
    press(1);
    press(0);
    expect(onChange).toHaveBeenCalledTimes(2);
    for (const [value] of onChange.mock.calls) {
      expect(value == null || value <= 5).toBe(true);
    }
  });
});
