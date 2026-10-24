import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IGridTheme } from '../../configs';
import { SpriteManager } from './SpriteManager';

const theme = { iconFgCommon: '#000', iconBgCommon: '#fff' } as IGridTheme;
const props = { x: 0, y: 0, size: 16, sprite: 'broken', theme };

describe('SpriteManager', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drops a sprite whose decode fails and retries it a bounded number of times', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const decode = vi
      .spyOn(HTMLImageElement.prototype, 'decode')
      .mockImplementation(() => Promise.reject(new Error('decode failed')));
    const onSettled = vi.fn();
    const manager = new SpriteManager({ broken: () => '<svg />' }, onSettled);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const flush = () => new Promise((resolve) => setTimeout(resolve));

    for (let i = 0; i < 5; i++) {
      manager.drawSprite(ctx, props);
      await flush();
    }

    // no blank canvas is kept and drawn; decoding stops after three failures
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(3);
  });
});
