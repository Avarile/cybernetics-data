import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverflowTooltip } from './OverflowTooltip';

// happy-dom has no layout, so derive the measured size from the rendered text length.
const lineHeight = 20;
const charsPerLine = 10;

const measure = (element: HTMLElement) => (element.textContent ?? '').length;

describe('OverflowTooltip', () => {
  beforeEach(() => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: `${lineHeight}px`,
    } as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      const wraps = this.style.whiteSpace !== 'nowrap';
      return wraps ? Math.max(1, Math.ceil(measure(this) / charsPerLine)) * lineHeight : lineHeight;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.style.whiteSpace === 'nowrap' ? measure(this) : charsPerLine;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(charsPerLine);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves tooltip mode once the text fits again', () => {
    const { rerender } = render(<OverflowTooltip ellipsis text="a text that overflows the cell" />);
    expect(screen.queryByRole('button')).toBeInTheDocument();

    rerender(<OverflowTooltip ellipsis text="short" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('short')).toBeInTheDocument();
  });

  it('applies the style prop in both modes', () => {
    const style = { color: 'red' };
    const { rerender } = render(<OverflowTooltip ellipsis text="short" style={style} />);
    expect(screen.getByText('short').style.color).toBe('red');

    rerender(<OverflowTooltip ellipsis text="a text that overflows the cell" style={style} />);
    expect(screen.queryByRole('button')).toBeInTheDocument();
    expect(screen.getByText('a text that overflows the cell').style.color).toBe('red');
  });
});
