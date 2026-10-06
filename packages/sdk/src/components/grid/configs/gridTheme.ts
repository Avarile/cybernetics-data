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

export const gridTheme: IGridTheme = {
  // Common
  staticWhite: '#FFFFFF',
  staticBlack: '#000000',
  iconFgCommon: '#948D7B',
  iconBgCommon: colors.transparent,
  iconFgHighlight: '#FFB547',
  iconBgHighlight: '#FFB547',
  iconFgSelected: '#070605',
  iconBgSelected: '#FFB547',
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
    'Inter, Roboto, -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, noto, arial, sans-serif',

  // Cell
  cellBg: '#0E0C08',
  cellBgHovered: '#15120C',
  cellBgSelected: '#1C170F',
  cellBgLoading: hexToRGBA('#FFB547', 0.06),
  cellLineColor: '#231E15',
  cellLineColorActived: '#FFB547',
  cellTextColor: '#E8DFCB',
  cellTextColorHighlight: '#4DE8FF',
  cellOptionBg: '#2A2316',
  cellOptionBgHighlight: '#3A3223',
  cellOptionTextColor: '#FFD08A',

  // Group Header
  groupHeaderBgPrimary: '#070605',
  groupHeaderBgSecondary: '#0E0C08',
  groupHeaderBgTertiary: '#15120C',

  // Column Statistic
  columnStatisticBgHoveredPrimary: '#0E0C08',
  columnStatisticBgHoveredSecondary: '#15120C',
  columnStatisticBgHoveredTertiary: '#1C170F',

  // Column Header
  columnHeaderBg: '#070605',
  columnHeaderBgHovered: '#0E0C08',
  columnHeaderBgSelected: '#1C170F',
  columnHeaderNameColor: '#E8DFCB',
  columnResizeHandlerBg: '#4DE8FF',
  columnDraggingPlaceholderBg: hexToRGBA('#FFB547', 0.15),

  // Row Header
  rowHeaderTextColor: '#948D7B',

  // Append Row
  appendRowBg: '#070605',
  appendRowBgHovered: '#0E0C08',

  // Avatar Theme
  avatarBg: '#2A2316',
  avatarTextColor: '#FFD08A',
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'light',

  // ScrollBar
  scrollBarBg: '#3A3223',

  // interaction
  interactionLineColorCommon: '#3A3223',
  interactionLineColorHighlight: '#4DE8FF',

  // search cursor
  searchCursorBg: '#3A2A10',
  searchTargetIndexBg: '#221A0C',

  // comment
  commentCountBg: '#FF4F8B',
  commentCountTextColor: '#070605',
};
