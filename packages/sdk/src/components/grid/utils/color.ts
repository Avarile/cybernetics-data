export interface IRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};

const parseAlpha = (value?: string) => {
  if (value == null || value === '') return 1;
  const trimmed = value.trim();
  return clamp(trimmed.endsWith('%') ? parseFloat(trimmed) / 100 : parseFloat(trimmed), 0, 1);
};

/**
 * Parses `#rgb`, `#rrggbb`, `rgb()/rgba()`, `hsl()/hsla()` and bare shadcn HSL triplets such as
 * `220 85% 51%` or `36 100% 63.9% / 0.06` (the form our CSS variables are stored in).
 */
export const parseColor = (input: string): IRgba | null => {
  const value = input.trim();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const [r, g, b] = hex.split('').map((c) => parseInt(c + c, 16));
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    return null;
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgbMatch) {
    const [color, alpha] = rgbMatch[1].split('/');
    const parts = color.split(/[\s,]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map((p) => Math.round(parseFloat(p)));
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a: parseAlpha(alpha ?? parts[3]) };
  }

  const hslBody = /^hsla?\(([^)]+)\)$/i.exec(value)?.[1] ?? value;
  const [color, alpha] = hslBody.split('/');
  const parts = color.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [h, s, l] = parts.slice(0, 3).map((p) => parseFloat(p));
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;
  const [r, g, b] = hslToRgb(h, s, l);
  return { r, g, b, a: parseAlpha(alpha ?? parts[3]) };
};

export const toRgbaString = ({ r, g, b, a }: IRgba) =>
  a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;

/**
 * Same result as CSS `color-mix(in srgb, a <weight>, b)`: `weight` is the share of `a` (0..1).
 * Canvas cannot evaluate `color-mix`, so the grid theme pre-computes its mixes with this.
 */
export const mixColor = (a: string, b: string, weight: number) => {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const t = clamp(weight, 0, 1);
  const mix = (x: number, y: number) => Math.round(x * t + y * (1 - t));
  return toRgbaString({
    r: mix(ca.r, cb.r),
    g: mix(ca.g, cb.g),
    b: mix(ca.b, cb.b),
    a: ca.a * t + cb.a * (1 - t),
  });
};

/** `#rrggbb` (alpha dropped): grid code passes theme colours to `hexToRGBA`, which needs hex. */
export const toHex = (color: string) => {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const hex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${hex(parsed.r)}${hex(parsed.g)}${hex(parsed.b)}`;
};

export const withAlpha = (color: string, alpha: number) => {
  const parsed = parseColor(color);
  if (!parsed) return color;
  return toRgbaString({ ...parsed, a: clamp(alpha, 0, 1) });
};
