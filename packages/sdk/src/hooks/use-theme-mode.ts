import { useTheme } from '@teable/next-themes';

export type IThemeMode = 'light' | 'dark';

// themes that render on a dark canvas; their assets (icons, illustrations) use the dark variants
export const DARK_THEMES = ['dark', 'cyberpunk'];

export const APP_THEMES = ['light', 'dark', 'cyberpunk'];

export const getThemeMode = (theme?: string): IThemeMode =>
  theme && DARK_THEMES.includes(theme) ? 'dark' : 'light';

/** Collapses the resolved theme (light, dark, cyberpunk, ...) to the light/dark mode it renders in */
export const useThemeMode = (): IThemeMode => {
  const { resolvedTheme } = useTheme();
  return getThemeMode(resolvedTheme);
};
