import type { EditorView } from '@milkdown/prose/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLinkClickPlugin } from './milkdown-link-click-plugin';

const clickLink = (href: string) => {
  const plugin = createLinkClickPlugin(true);
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  document.body.appendChild(anchor);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: anchor });

  const handled = plugin.props.handleDOMEvents?.click?.call(
    plugin,
    {} as EditorView,
    event as MouseEvent
  );
  anchor.remove();
  return { handled, event };
};

describe('createLinkClickPlugin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens safe links in readonly mode', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { handled } = clickLink('https://example.com');

    expect(handled).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('does not open or follow javascript: links', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { handled, event } = clickLink('javascript:alert(1)');

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
