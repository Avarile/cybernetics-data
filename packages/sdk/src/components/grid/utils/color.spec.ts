import { mixColor, parseColor, toRgbaString, withAlpha } from './color';

describe('parseColor', () => {
  it('parses hex in short and long form', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#1961ed')).toEqual({ r: 25, g: 97, b: 237, a: 1 });
  });

  it('parses rgb and rgba', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('parses shadcn HSL triplets with and without alpha', () => {
    expect(parseColor('0 0% 100%')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('0 0% 20%')).toEqual({ r: 51, g: 51, b: 51, a: 1 });
    expect(parseColor('220 85% 51% / 0.25')).toMatchObject({ a: 0.25 });
    expect(parseColor('hsl(0 0% 0%)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('returns null for unknown input', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });
});

describe('mixColor', () => {
  it('returns the endpoints at weight 1 and 0', () => {
    expect(mixColor('#ff0000', '#0000ff', 1)).toBe('rgb(255, 0, 0)');
    expect(mixColor('#ff0000', '#0000ff', 0)).toBe('rgb(0, 0, 255)');
  });

  it('mixes like color-mix(in srgb)', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    expect(mixColor('#1961ed', '#ffffff', 0.07)).toBe('rgb(239, 244, 254)');
  });

  it('clamps the weight and passes through unparseable input', () => {
    expect(mixColor('#000000', '#ffffff', 2)).toBe('rgb(0, 0, 0)');
    expect(mixColor('nope', '#ffffff', 0.5)).toBe('nope');
  });
});

describe('withAlpha / toRgbaString', () => {
  it('sets alpha', () => {
    expect(withAlpha('#1961ed', 0.1)).toBe('rgba(25, 97, 237, 0.1)');
    expect(toRgbaString({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)');
  });
});
