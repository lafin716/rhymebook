import { create } from 'zustand';

export const PALETTES = [
  { id: 'ocean', name: '오션', description: '선명한 파란빛의 깊은 바다', colors: ['#1761b5', '#142d4e', '#dde9f7', '#4a8cda'] },
  { id: 'lagoon', name: '라군', description: '햇살이 스미는 민트빛 물결', colors: ['#116348', '#183e32', '#e6f1e9', '#5d9170'] },
  { id: 'coral', name: '코랄', description: '따뜻한 산호초의 분홍빛', colors: ['#9d304b', '#472433', '#f4e5e5', '#c86c84'] },
  { id: 'abyss', name: '어비스', description: '고요한 심해의 보랏빛', colors: ['#5940a6', '#28203f', '#e9e4f5', '#9073c5'] },
  { id: 'pearl', name: '펄', description: '조개껍질처럼 차분한 모래빛', colors: ['#695137', '#342b21', '#ece7dc', '#a78a61'] },
  { id: 'vscode', name: 'VS Code', description: '코드 편집기처럼 차분한 회색 화면', colors: ['#1f1f1f', '#2b2b2b', '#007acc', '#4daafc'] },
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
