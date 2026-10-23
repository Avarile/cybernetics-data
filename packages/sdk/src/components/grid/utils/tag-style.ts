import { mixColor } from './color';

/** Hue bases shared by both themes (design D4); tints are mixed against the theme surface. */
export const TAG_HUES = {
  blue: '#0090ff',
  cyan: '#00a2c7',
  gray: '#8d8d8d',
  green: '#30a46c',
  orange: '#f76b15',
  pink: '#d6409f',
  purple: '#8e4ec6',
  red: '#e5484d',
  teal: '#12a594',
  yellow: '#e2a336',
} as const;

export type ITagHue = keyof typeof TAG_HUES;
export type ITagIntensity = 'outline' | 'soft' | 'strong';

export interface ITagPalette {
  /** Surface the tag sits on (cell background). */
  surface: string;
  /** Theme foreground; text is the hue mixed towards it. */
  foreground: string;
}

export interface ITagStyle {
  bg: string;
  fg: string;
  border: string | null;
  fontWeight: 400 | 500;
}

const SHADE_PATTERN = /^([a-z]+)(Light[12]|Bright|Dark1)?$/;

export const getTagHue = (color: string): ITagHue => {
  const hue = SHADE_PATTERN.exec(color)?.[1];
  return hue && hue in TAG_HUES ? (hue as ITagHue) : 'gray';
};

/** The palette stores 5 shades per hue; they map onto 3 intensities so stored pairs stay distinct. */
export const getTagIntensity = (color: string): ITagIntensity => {
  const shade = SHADE_PATTERN.exec(color)?.[2];
  if (shade === 'Light1' || shade === 'Light2') return 'outline';
  if (shade === 'Dark1') return 'strong';
  return 'soft';
};

export const getTagStyle = (color: string, palette: ITagPalette): ITagStyle => {
  const base = TAG_HUES[getTagHue(color)];
  const { surface, foreground } = palette;
  switch (getTagIntensity(color)) {
    case 'outline':
      return {
        bg: 'transparent',
        fg: mixColor(base, foreground, 0.62),
        border: mixColor(base, surface, 0.42),
        fontWeight: 400,
      };
    case 'strong':
      return {
        bg: mixColor(base, surface, 0.3),
        fg: mixColor(base, foreground, 0.42),
        border: null,
        fontWeight: 500,
      };
    default:
      return {
        bg: mixColor(base, surface, 0.13),
        fg: mixColor(base, foreground, 0.62),
        border: null,
        fontWeight: 400,
      };
  }
};

export interface ITagCss {
  color: string;
  backgroundColor: string;
  borderColor?: string;
  fontWeight?: number;
}

const cssMix = (a: string, b: string, weight: number) =>
  `color-mix(in srgb, ${a} ${Math.round(weight * 100)}%, ${b})`;

/**
 * DOM twin of `getTagStyle`: the same three intensities written as CSS `color-mix` against the
 * theme variables, so DOM tags follow light / dark without JS (design D4).
 */
export const getTagCss = (color: string): ITagCss => {
  const base = TAG_HUES[getTagHue(color)];
  const surface = 'hsl(var(--background))';
  const foreground = 'hsl(var(--foreground))';
  switch (getTagIntensity(color)) {
    case 'outline':
      return {
        backgroundColor: 'transparent',
        color: cssMix(base, foreground, 0.62),
        borderColor: cssMix(base, surface, 0.42),
      };
    case 'strong':
      return {
        backgroundColor: cssMix(base, surface, 0.3),
        color: cssMix(base, foreground, 0.42),
        fontWeight: 500,
      };
    default:
      return {
        backgroundColor: cssMix(base, surface, 0.13),
        color: cssMix(base, foreground, 0.62),
      };
  }
};
