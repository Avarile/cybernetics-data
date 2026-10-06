import { useTheme } from '@teable/next-themes';
import type { IGridTheme } from '../../grid/configs';
import { hexToRGBA } from '../../grid/utils';

const lightTheme = {} as IGridTheme;

const darkTheme = {
  // Common
  iconFgCommon: '#948D7B',

  // Cell
  cellBg: '#0E0C08',
  cellBgHovered: '#15120C',
  cellBgSelected: '#1C170F',
  cellBgLoading: hexToRGBA('#FFB547', 0.06),
  cellLineColor: '#231E15',
  cellLineColorActived: '#FFB547',
  cellTextColor: '#E8DFCB',
  cellOptionBg: '#2A2316',
  cellOptionTextColor: '#FFD08A',

  // Group Header
  groupHeaderBgPrimary: '#070605',
  groupHeaderBgSecondary: '#0E0C08',
  groupHeaderBgTertiary: '#15120C',

  // Column Header
  columnHeaderBg: '#070605',
  columnHeaderBgHovered: '#0E0C08',
  columnHeaderBgSelected: '#1C170F',
  columnHeaderNameColor: '#E8DFCB',
  columnResizeHandlerBg: '#4DE8FF',
  columnDraggingPlaceholderBg: hexToRGBA('#FFB547', 0.15),

  // Column Statistic
  columnStatisticBgHoveredPrimary: '#0E0C08',
  columnStatisticBgHoveredSecondary: '#15120C',
  columnStatisticBgHoveredTertiary: '#1C170F',

  // Row Header
  rowHeaderTextColor: '#948D7B',

  // Append Row
  appendRowBg: '#070605',
  appendRowBgHovered: '#0E0C08',

  // Avatar
  avatarBg: '#2A2316',
  avatarTextColor: '#FFD08A',
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'dark',

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
} as IGridTheme;

export function useGridTheme(): IGridTheme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? darkTheme : lightTheme;
}
