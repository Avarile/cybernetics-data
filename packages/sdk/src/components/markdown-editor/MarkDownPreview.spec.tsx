import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkDownPreview';

describe('MarkdownPreview', () => {
  it('keeps safe raw HTML', () => {
    const { container } = render(
      <MarkdownPreview>{'<details><summary>More</summary>Body</details>'}</MarkdownPreview>
    );

    expect(container.querySelector('details summary')?.textContent).toBe('More');
  });

  it('strips event handlers and scripts from raw HTML', () => {
    const { container } = render(
      <MarkdownPreview>
        {
          '<img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>'
        }
      </MarkdownPreview>
    );

    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
  });
});
