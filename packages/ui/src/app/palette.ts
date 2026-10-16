import { create } from 'zustand';

export const PALETTES = [
  { id: 'ocean', name: '오션', description: '깊고 맑은 푸른 바다', colors: ['#087e8b', '#173c4b', '#d8eef1', '#f2a38a'] },
  { id: 'lagoon', name: '라군', description: '햇살이 스미는 민트빛 물결', colors: ['#16735b', '#224e43', '#ddf3e8', '#dfc78c'] },
  { id: 'coral', name: '코랄', description: '따뜻한 산호초의 분홍빛', colors: ['#ac475c', '#5c3444', '#f8e4e7', '#e6b58b'] },
  { id: 'abyss', name: '어비스', description: '고요한 심해의 보랏빛', colors: ['#6653b3', '#353259', '#eae5fa', '#9bbde3'] },
  { id: 'pearl', name: '펄', description: '조개껍질처럼 차분한 모래빛', colors: ['#776147', '#494337', '#eee8dd', '#a7c6c5'] },
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
