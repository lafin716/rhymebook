import { t } from '../i18n';
import { create } from 'zustand';

export const PALETTES = [
  { id: 'ocean', get name() { return t('app.palette.ocean.name'); }, get description() { return t('app.palette.ocean.description'); }, colors: ['#1761b5', '#142d4e', '#dde9f7', '#4a8cda'] },
  { id: 'lagoon', get name() { return t('app.palette.lagoon.name'); }, get description() { return t('app.palette.lagoon.description'); }, colors: ['#116348', '#183e32', '#e6f1e9', '#5d9170'] },
  { id: 'coral', get name() { return t('app.palette.coral.name'); }, get description() { return t('app.palette.coral.description'); }, colors: ['#9d304b', '#472433', '#f4e5e5', '#c86c84'] },
  { id: 'abyss', get name() { return t('app.palette.abyss.name'); }, get description() { return t('app.palette.abyss.description'); }, colors: ['#5940a6', '#28203f', '#e9e4f5', '#9073c5'] },
  { id: 'pearl', get name() { return t('app.palette.pearl.name'); }, get description() { return t('app.palette.pearl.description'); }, colors: ['#695137', '#342b21', '#ece7dc', '#a78a61'] },
  { id: 'vscode', get name() { return t('app.palette.vscode.name'); }, get description() { return t('app.palette.vscode.description'); }, colors: ['#1f1f1f', '#2b2b2b', '#007acc', '#4daafc'] },
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];
export const PALETTE_KEY = 'octobooks.palette';

export function isPalette(value: unknown): value is PaletteId {
  return PALETTES.some((palette) => palette.id === value);
}

export function readPalette(): PaletteId {
  try {
    const value = localStorage.getItem(PALETTE_KEY);
    return isPalette(value) ? value : 'ocean';
  } catch {
    return 'ocean';
  }
}

/** Device-local presentation: never written into the PC's synchronized learning data. */
export const usePalette = create<{ palette: PaletteId; setPalette(palette: PaletteId): void }>((set) => ({
  palette: readPalette(),
  setPalette(palette) {
    if (!isPalette(palette)) return;
    set({ palette });
    try {
      localStorage.setItem(PALETTE_KEY, palette);
    } catch {
      // Keep the in-memory selection even when storage is unavailable.
    }
  },
}));
