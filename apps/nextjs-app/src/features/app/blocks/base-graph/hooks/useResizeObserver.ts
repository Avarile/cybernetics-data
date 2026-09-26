import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

export interface ISize {
  width: number;
  height: number;
}

/**
 * Observes a container and reports its content-box size.
 *
 * Written locally rather than reused from the SDK: the grid's version is not
 * exported from any public subpath, and it applies a grid-specific
 * `document.body.clientHeight - window.innerHeight` correction that would
 * mis-size a 3D canvas.
 *
 * A ResizeObserver rather than window listeners, because the sidebar can resize
 * the container without a window resize ever firing.
 */
export const useResizeObserver = <T extends HTMLElement>(ref: RefObject<T>): ISize => {
  const [size, setSize] = useState<ISize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
};
