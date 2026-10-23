import { gridTheme } from '../../grid/configs';
import { buildGridTheme } from './use-grid-theme';

const light: Record<string, string> = {
  background: '0 0% 100%',
  foreground: '0 0% 20%',
  primary: '220 85% 51%',
  'foreground-tertiary': '0 0% 60%',
  'border-light': '0 0% 94.5%',
  selection: '221 85% 97%',
};
const dark: Record<string, string> = {
  ...light,
  background: '0 0% 9%',
  foreground: '0 0% 92.2%',
  primary: '219 91% 63%',
};

describe('buildGridTheme', () => {
  it('reads the shadcn variables and returns hex colours', () => {
    const theme = buildGridTheme((n) => light[n], 'light');
    expect(theme.cellBg).toBe('#ffffff');
    expect(theme.cellTextColor).toBe('#333333');
    expect(theme.cellLineColorActived).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.cellLineColor).toBe('#f1f1f1');
    expect(theme.themeKey).toBe('light');
  });

  it('follows the dark variables', () => {
    const theme = buildGridTheme((n) => dark[n], 'dark');
    expect(theme.cellBg).toBe('#171717');
    expect(theme.cellTextColor).toBe('#ebebeb');
    expect(theme.columnHeaderBg).toBe(theme.cellBg);
    expect(theme.themeKey).toBe('dark');
  });

  it('falls back to the light defaults for missing variables', () => {
    const theme = buildGridTheme(() => undefined, 'light');
    expect(theme.cellBg).toBe(gridTheme.cellBg);
    expect(theme.scrollBarBg).toBe(gridTheme.scrollBarBg);
  });

  it('keeps every key of the default theme (no key renamed or dropped)', () => {
    const theme = buildGridTheme((n) => light[n], 'light');
    expect(Object.keys(theme).sort()).toEqual(Object.keys(gridTheme).sort());
  });

  it('contains no amber values', () => {
    const values = JSON.stringify(buildGridTheme((n) => dark[n], 'dark')).toLowerCase();
    for (const amber of ['#ffb547', '#4de8ff', '#0e0c08', '#ffd08a']) {
      expect(values).not.toContain(amber);
    }
  });
});
