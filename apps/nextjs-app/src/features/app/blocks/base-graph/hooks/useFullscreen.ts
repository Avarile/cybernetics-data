import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

/**
 * Owns nothing: the browser is the source of truth via
 * `document.fullscreenElement`. The flag is derived from the
 * `fullscreenchange` event rather than mirrored into a store, so pressing
 * Escape cannot desync it.
 */
export const useFullscreen = <T extends HTMLElement>(ref: RefObject<T>) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref]);

  const toggle = useCallback(async () => {
    const element = ref.current;
    if (!element) {
      return;
    }
    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen();
      }
    } catch {
      // The API rejects when the gesture is not user-initiated or the browser
      // blocks it. The state stays whatever the browser actually did.
    }
  }, [ref]);

  return { isFullscreen, toggle };
};
