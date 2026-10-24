import { describe, expect, it } from 'vitest';
import { drawMultiLineText, drawSingleLineText } from './baseRenderer';

// 'W' is 5px wide and every other character 1px, times the font scale
const createCtx = (font = '13px test', scale = 1) =>
  ({
    font,
    direction: 'ltr',
    measureText: (text: string) => ({
      width: [...String(text)].reduce((sum, char) => sum + (char === 'W' ? 5 : 1), 0) * scale,
    }),
  }) as unknown as CanvasRenderingContext2D;

describe('drawSingleLineText', () => {
  it('subtracts the width of the removed character when trimming for the ellipsis', () => {
    // "aaaaW" fits 9px; making room for "..." (3px) must drop the 5px "W", leaving "aaaa"
    const { text, width } = drawSingleLineText(createCtx(), {
      text: 'aaaaWaaa',
      maxWidth: 9,
      needRender: false,
    });

    expect(text).toBe('aaaa...');
    expect(width).toBe(7);
  });

  it('does not reuse widths measured with a different font', () => {
    const props = { text: 'font-key-check', needRender: false };
    const small = drawSingleLineText(createCtx('13px test'), props);
    const large = drawSingleLineText(createCtx('26px test', 2), props);

    expect(large.width).toBe(small.width * 2);
  });
});

describe('drawMultiLineText', () => {
  it('subtracts the width of the removed character when trimming the last line', () => {
    const lines = drawMultiLineText(createCtx('14px multi'), {
      text: 'aaaaWaaa',
      maxWidth: 9,
      maxLines: 1,
      needRender: false,
    });

    expect(lines).toEqual([{ text: 'aaaa...', width: 7 }]);
  });
});
