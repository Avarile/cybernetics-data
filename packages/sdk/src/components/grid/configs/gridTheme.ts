import colors from 'tailwindcss/colors';
import { hexToRGBA } from '../utils';

export interface IGridTheme {
  staticWhite: string;
  staticBlack: string;
  iconBgCommon: string;
  iconFgCommon: string;
  iconFgHighlight: string;
  iconBgHighlight: string;
  iconBgSelected: string;
  iconFgSelected: string;
  iconSizeXS: number;
  iconSizeSM: number;
  iconSizeMD: number;
  iconSizeLG: number;
  fontSizeXXS: number;
  fontSizeXS: number;
  fontSizeSM: number;
  fontSizeMD: number;
  fontSizeLG: number;
  fontFamily: string;
  cellBg: string;
  cellBgHovered: string;
  cellBgSelected: string;
  cellBgLoading: string;
  cellLineColor: string;
  cellLineColorActived: string;
  cellTextColor: string;
  cellTextColorHighlight: string;
  cellOptionBg: string;
  cellOptionBgHighlight: string;
  cellOptionTextColor: string;
  groupHeaderBgPrimary: string;
  groupHeaderBgSecondary: string;
  groupHeaderBgTertiary: string;
  columnHeaderBg: string;
  columnHeaderBgHovered: string;
  columnHeaderBgSelected: string;
  columnHeaderNameColor: string;
  columnResizeHandlerBg: string;
  columnDraggingPlaceholderBg: string;
  columnStatisticBgHoveredPrimary: string;
  columnStatisticBgHoveredSecondary: string;
  columnStatisticBgHoveredTertiary: string;
  rowHeaderTextColor: string;
  appendRowBg: string;
  appendRowBgHovered: string;
  avatarBg: string;
  avatarTextColor: string;
  avatarSizeXS: number;
  avatarSizeSM: number;
  avatarSizeMD: number;
  themeKey: string;
  scrollBarBg: string;
  interactionLineColorCommon: string;
  interactionLineColorHighlight: string;
  searchCursorBg: string;
  searchTargetIndexBg: string;
  commentCountBg: string;
  commentCountTextColor: string;
}

/**
 * Light defaults, used before the CSS variables can be read (SSR, tests, previews). At runtime
 * `useGridTheme` rebuilds the theme from the variables in global.shadcn.css, so both themes come
 * from one source (design D2). Colours stay `#rrggbb`: grid code passes them to `hexToRGBA`.
 */
export const gridTheme: IGridTheme = {
  // Common
  staticWhite: '#FFFFFF',
  staticBlack: '#000000',
  iconFgCommon: '#999999',
  iconBgCommon: colors.transparent,
  iconFgHighlight: '#1961ed',
  iconBgHighlight: '#1961ed',
  iconFgSelected: '#ffffff',
  iconBgSelected: '#1961ed',
  iconSizeXS: 16,
  iconSizeSM: 20,
  iconSizeMD: 24,
  iconSizeLG: 32,
  fontSizeXXS: 10,
  fontSizeXS: 12,
  fontSizeSM: 13,
  fontSizeMD: 14,
  fontSizeLG: 16,
  fontFamily:
    "'Inter Variable', Inter, Roboto, -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, noto, arial, sans-serif",

  // Cell
  cellBg: '#ffffff',
  cellBgHovered: '#fafafa',
  cellBgSelected: '#eff4fe',
  cellBgLoading: hexToRGBA('#1961ed', 0.06),
  cellLineColor: '#f1f1f1',
  cellLineColorActived: '#1961ed',
  cellTextColor: '#333333',
  cellTextColorHighlight: '#1961ed',
  cellOptionBg: '#ebebeb',
  cellOptionBgHighlight: '#d6d6d6',
  cellOptionTextColor: '#333333',

  // Group Header
  groupHeaderBgPrimary: '#fafafa',
  groupHeaderBgSecondary: '#f1f1f1',
  groupHeaderBgTertiary: '#ebebeb',

  // Column Statistic
  columnStatisticBgHoveredPrimary: '#f1f1f1',
  columnStatisticBgHoveredSecondary: '#f1f1f1',
  columnStatisticBgHoveredTertiary: '#ebebeb',

  // Column Header
  columnHeaderBg: '#ffffff',
  columnHeaderBgHovered: '#f1f1f1',
  columnHeaderBgSelected: '#eff4fe',
  columnHeaderNameColor: '#666666',
  columnResizeHandlerBg: '#1961ed',
  columnDraggingPlaceholderBg: hexToRGBA('#1961ed', 0.1),

  // Row Header
  rowHeaderTextColor: '#999999',

  // Append Row
  appendRowBg: '#ffffff',
  appendRowBgHovered: '#fafafa',

  // Avatar Theme
  avatarBg: '#f1f1f1',
  avatarTextColor: '#666666',
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'light',

  // ScrollBar
  scrollBarBg: '#d6d6d6',

  // interaction
  interactionLineColorCommon: '#d6d6d6',
  interactionLineColorHighlight: '#1961ed',

  // search cursor
  searchCursorBg: '#f4d9ab',
  searchTargetIndexBg: '#faefdc',

  // comment
  commentCountBg: '#e5484d',
  commentCountTextColor: '#ffffff',
};
