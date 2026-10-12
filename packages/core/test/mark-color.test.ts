import { describe, expect, it } from 'vitest';
import { isMarkColor, normalizeMarkColor } from '../src/model';

describe('mark colors', () => {
  it('accepts presets and lowercase #rrggbb only', () => {
    expect(isMarkColor('yellow')).toBe(true);
    expect(isMarkColor('#a1b2c3')).toBe(true);
    expect(isMarkColor('#A1B2C3')).toBe(false);
    expect(isMarkColor('#abc')).toBe(false);
    expect(isMarkColor('pink')).toBe(false);
    expect(isMarkColor(3)).toBe(false);
  });

  it('normalizes user input', () => {
    expect(normalizeMarkColor(' #ABC ')).toBe('#aabbcc');
    expect(normalizeMarkColor('A1B2C3')).toBe('#a1b2c3');
    expect(normalizeMarkColor('Blue')).toBe('blue');
    expect(normalizeMarkColor('#12345')).toBeNull();
    expect(normalizeMarkColor('rgb(0,0,0)')).toBeNull();
  });
});
