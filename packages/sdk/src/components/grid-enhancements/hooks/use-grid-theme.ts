import { useTheme } from '@teable/next-themes';
import { useEffect, useState } from 'react';
import type { IGridTheme } from '../../grid/configs';
import { gridTheme } from '../../grid/configs';
import { mixColor, TAG_HUES, toHex, withAlpha } from '../../grid/utils';

type IReadVar = (name: string) => string | undefined;
type IThemeKey = 'light' | 'dark';

/**
 * Builds the canvas theme from the CSS variables in global.shadcn.css (design D2), so the grid
 * and the DOM share one colour source. Every value falls back to the light default.
 */
export const buildGridTheme = (read: IReadVar, themeKey: IThemeKey): IGridTheme => {
  const color = (name: string, fallback: string) => {
    const raw = read(name);
    return raw ? toHex(raw) : fallback;
  };
  const d = gridTheme;
  const background = color('background', d.cellBg);
  const foreground = color('foreground', d.cellTextColor);
  const primary = color('primary', d.cellLineColorActived);
  const tertiary = color('foreground-tertiary', d.iconFgCommon);
  const accent = color('accent', d.columnHeaderBgHovered);
  const secondary = color('secondary', d.groupHeaderBgTertiary);
  const backgroundSecondary = color('background-secondary', d.cellBgHovered);
  const borderHigh = color('border-high', d.scrollBarBg);
  const selection = color('selection', d.cellBgSelected);

  return {
    ...d,
    themeKey,
    iconFgCommon: tertiary,
    iconFgHighlight: primary,
    iconBgHighlight: primary,
    iconFgSelected: color('primary-foreground', d.iconFgSelected),
    iconBgSelected: primary,

    cellBg: background,
    cellBgHovered: backgroundSecondary,
    cellBgSelected: selection,
    cellBgLoading: withAlpha(primary, 0.06),
    cellLineColor: color('border-light', d.cellLineColor),
    cellLineColorActived: primary,
    cellTextColor: foreground,
    cellTextColorHighlight: primary,
    cellOptionBg: secondary,
    cellOptionBgHighlight: borderHigh,
    cellOptionTextColor: foreground,

    groupHeaderBgPrimary: backgroundSecondary,
    groupHeaderBgSecondary: accent,
    groupHeaderBgTertiary: secondary,

    columnStatisticBgHoveredPrimary: accent,
    columnStatisticBgHoveredSecondary: accent,
    columnStatisticBgHoveredTertiary: secondary,

    columnHeaderBg: background,
    columnHeaderBgHovered: accent,
    columnHeaderBgSelected: selection,
    columnHeaderNameColor: color('muted-foreground', d.columnHeaderNameColor),
    columnResizeHandlerBg: primary,
    columnDraggingPlaceholderBg: withAlpha(primary, 0.1),

    rowHeaderTextColor: tertiary,

    appendRowBg: background,
    appendRowBgHovered: backgroundSecondary,

    avatarBg: accent,
    avatarTextColor: color('muted-foreground', d.avatarTextColor),

    scrollBarBg: borderHigh,

    interactionLineColorCommon: borderHigh,
    interactionLineColorHighlight: primary,

    searchCursorBg: mixColor(TAG_HUES.yellow, background, 0.45),
    searchTargetIndexBg: mixColor(TAG_HUES.yellow, background, 0.22),

    commentCountBg: color('destructive', d.commentCountBg),
    commentCountTextColor: color('destructive-foreground', d.commentCountTextColor),
  };
};

const readRootVars = (): IReadVar => {
  const styles = getComputedStyle(document.documentElement);
  return (name) => styles.getPropertyValue(`--${name}`).trim() || undefined;
};

const currentThemeKey = (): IThemeKey =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';

const computeTheme = () =>
  typeof window === 'undefined' ? gridTheme : buildGridTheme(readRootVars(), currentThemeKey());

export function useGridTheme(): IGridTheme {
  const { resolvedTheme } = useTheme();
  const [theme, setTheme] = useState<IGridTheme>(computeTheme);

  useEffect(() => {
    // next-themes swaps the root class in its own effect; watch the class so the variables are
    // read after the swap rather than racing it
    const update = () =>
      setTheme((prev) => {
        const next = computeTheme();
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  return theme;
}
