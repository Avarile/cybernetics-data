import { Colors } from '@teable/core';
import { getTagHue, getTagIntensity, getTagStyle, TAG_HUES } from './tag-style';

const light = { surface: '#ffffff', foreground: '#333333' };
const dark = { surface: '#171717', foreground: '#ebebeb' };

describe('tag style', () => {
  it('maps every stored colour to a known hue and intensity', () => {
    for (const color of Object.values(Colors)) {
      expect(Object.keys(TAG_HUES)).toContain(getTagHue(color));
      expect(['outline', 'soft', 'strong']).toContain(getTagIntensity(color));
      const style = getTagStyle(color, light);
      expect(style.fg).toMatch(/^rgb/);
    }
  });

  it('maps the five shades onto three intensities (design D4)', () => {
    expect(getTagIntensity(Colors.RedLight2)).toBe('outline');
    expect(getTagIntensity(Colors.RedLight1)).toBe('outline');
    expect(getTagIntensity(Colors.RedBright)).toBe('soft');
    expect(getTagIntensity(Colors.Red)).toBe('soft');
    expect(getTagIntensity(Colors.RedDark1)).toBe('strong');
  });

  it('keeps the pairs used in data-centre distinct', () => {
    // tasks.priority: urgent = redDark1, important = redBright
    expect(getTagStyle(Colors.RedDark1, light)).not.toEqual(getTagStyle(Colors.RedBright, light));
    // tasks.progress: finished_reviewing = greenLight1, finished_validating = green
    expect(getTagStyle(Colors.GreenLight1, light)).not.toEqual(getTagStyle(Colors.Green, light));
  });

  it('draws outline tags with a border and no fill, strong tags bolder', () => {
    const outline = getTagStyle(Colors.GreenLight1, light);
    expect(outline.bg).toBe('transparent');
    expect(outline.border).not.toBeNull();
    expect(getTagStyle(Colors.PurpleDark1, light).fontWeight).toBe(500);
  });

  it('derives tints from the theme surface, so dark tags are dark', () => {
    expect(getTagStyle(Colors.Blue, light).bg).not.toEqual(getTagStyle(Colors.Blue, dark).bg);
    expect(getTagStyle(Colors.Blue, dark).bg).toBe('rgb(20, 39, 53)');
  });
});
