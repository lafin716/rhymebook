import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPalette, PALETTE_KEY, readPalette, usePalette } from '../src/app/palette';

afterEach(() => { vi.unstubAllGlobals(); usePalette.setState({ palette: 'ocean' }); });

describe('device-local color palette', () => {
  it('accepts only supported identifiers, without interpreting arbitrary storage values', () => {
    for (const id of ['ocean', 'lagoon', 'coral', 'abyss', 'pearl']) expect(isPalette(id)).toBe(true);
    for (const id of [null, undefined, 'dark', '', 'toString', '<script>']) expect(isPalette(id)).toBe(false);
  });
  it('restores a known selection and falls back for unknown values', () => {
    const getItem = vi.fn().mockReturnValue('coral');
    vi.stubGlobal('localStorage', { getItem });
    expect(readPalette()).toBe('coral');
    expect(getItem).toHaveBeenCalledWith(PALETTE_KEY);
    getItem.mockReturnValue('removed-theme');
    expect(readPalette()).toBe('ocean');
  });
  it('preserves the current selection when persistent storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } });
    expect(readPalette()).toBe('ocean');
    usePalette.getState().setPalette('abyss');
    expect(usePalette.getState().palette).toBe('abyss');
  });
  it('persists locally without writing core settings or host data', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    usePalette.getState().setPalette('pearl');
    expect(setItem).toHaveBeenCalledExactlyOnceWith(PALETTE_KEY, 'pearl');
    expect(usePalette.getState().palette).toBe('pearl');
  });
});
