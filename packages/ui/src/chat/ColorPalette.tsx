import { MARK_COLORS, normalizeMarkColor, type MarkColor, type MarkPreset } from '@branch/core';
import { Ban, Check, ChevronLeft, Pencil, Star, X } from 'lucide-react';
import { useState } from 'react';
import { MAX_FAVORITE_COLORS, useUi } from '../app/uiState';
import { cn } from '../lib/cn';

export type ColorKind = 'highlight' | 'underline' | 'textColor';

export const COLOR_KIND_LABELS: Record<ColorKind, string> = {
  highlight: '형광펜',
  underline: '밑줄',
  textColor: '글자색',
};

export const COLOR_LABELS: Record<MarkPreset, string> = {
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  red: '빨강',
  orange: '주황',
};

const isPreset = (c: MarkColor): c is MarkPreset => !c.startsWith('#');

/** 화면에 칠할 CSS 색: 추천 색은 테마 변수, 사용자 지정 색은 그대로 */
export function swatchCss(c: MarkColor, kind: ColorKind): string {
  if (!isPreset(c)) return c;
  return kind === 'textColor' ? `var(--mark-${c}-text)` : `var(--mark-${c})`;
}

export function colorLabel(c: MarkColor): string {
  return isPreset(c) ? COLOR_LABELS[c] : c.toUpperCase();
}

/** 추천 색의 현재 테마 실제 값 (#rrggbb). 색 선택기 초기값용 */
function resolveHex(c: MarkColor, kind: ColorKind): string {
  if (!isPreset(c)) return c;
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(kind === 'textColor' ? `--mark-${c}-text` : `--mark-${c}`)
      .trim();
    return normalizeMarkColor(v) ?? '#888888';
  } catch {
    return '#888888';
  }
}

export interface ColorPaletteProps {
  kind: ColorKind;
  /** 선택 범위에 지금 적용된 색 */
  current: MarkColor | undefined;
  mobile: boolean;
  /** null이면 해당 서식을 지운다 */
  onPick(c: MarkColor | null): void;
  onBack(): void;
}

/**
 * 서식 색상표: 즐겨찾기 · 추천 색 · 사용자 지정(색 선택기·HEX) · 없음.
 * 즐겨찾기는 기기별로 저장한다.
 */
export function ColorPalette({ kind, current, mobile, onPick, onBack }: ColorPaletteProps) {
  const favorites = useUi((s) => s.favoriteColors);
  const toggleFavorite = useUi((s) => s.toggleFavoriteColor);
  const [hex, setHex] = useState(() => resolveHex(current ?? 'yellow', kind));
  const [editing, setEditing] = useState(false);
  const draft = normalizeMarkColor(hex);
  const label = COLOR_KIND_LABELS[kind];
  /** ☆ 대상: 입력 중인 색 → 없으면 지금 적용된 색 */
  const starTarget = draft ?? current ?? null;
  const starred = !!starTarget && favorites.includes(starTarget);

  const swatch = (c: MarkColor, opts?: { removable?: boolean }) => {
    const on = current === c;
    return (
      <button
        key={c}
        type="button"
        aria-label={`${label} ${colorLabel(c)}${opts?.removable && editing ? ' 즐겨찾기에서 빼기' : ''}`}
        aria-pressed={on}
        title={colorLabel(c)}
        data-color={c}
        onClick={() => {
          if (opts?.removable && editing) {
            toggleFavorite(c);
            return;
          }
          setHex(resolveHex(c, kind));
          onPick(on ? null : c);
        }}
        className={cn('relative inline-flex items-center justify-center rounded-full', mobile ? 'size-9' : 'size-7')}
      >
        <span
          className={cn(
            'block rounded-full ring-offset-2 ring-offset-elev',
            mobile ? 'size-6' : 'size-5',
            on && 'ring-2 ring-fg',
            !isPreset(c) && 'shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]',
          )}
          style={{ background: swatchCss(c, kind) }}
        />
        {opts?.removable && editing && (
          <span className="absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-fg text-bg">
            <X size={9} strokeWidth={3} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-2 p-1" aria-label={`${label} 색상표`} role="group">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="서식으로 돌아가기"
          className="inline-flex size-7 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="flex-1 text-[13px] font-semibold">{label} 색</span>
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={!current}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-fg-2 hover:bg-surface-2 disabled:opacity-40"
        >
          <Ban size={13} /> 없음
        </button>
      </div>

      <div>
        <div className="mb-0.5 flex h-6 items-center justify-between px-1 text-[11.5px] font-medium text-muted">
          <span className="inline-flex items-center gap-1">
            <Star size={11} /> 즐겨찾기
          </span>
          {favorites.length > 0 && (
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              aria-pressed={editing}
              className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 hover:bg-surface-2 hover:text-fg"
            >
              {editing ? <Check size={11} /> : <Pencil size={11} />}
              {editing ? '완료' : '편집'}
            </button>
          )}
        </div>
        {favorites.length ? (
          <div className="flex flex-wrap gap-0.5">{favorites.map((c) => swatch(c, { removable: true }))}</div>
        ) : (
          <p className="px-1 text-[12px] leading-snug text-muted">아래 ☆ 버튼으로 자주 쓰는 색을 저장해요.</p>
        )}
      </div>

      <div>
        <div className="mb-0.5 px-1 text-[11.5px] font-medium text-muted">추천 색</div>
        <div className="flex flex-wrap gap-0.5">{MARK_COLORS.map((c) => swatch(c))}</div>
      </div>

      <div>
        <div className="mb-1 px-1 text-[11.5px] font-medium text-muted">사용자 지정</div>
        <form
          className="flex items-center gap-1.5 px-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft) onPick(draft);
          }}
        >
          <label
            className="relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-line"
            title="색 고르기"
            style={{ background: draft ?? 'transparent' }}
          >
            <input
              type="color"
              aria-label={`${label} 색 고르기`}
              value={draft ?? '#888888'}
              onChange={(e) => setHex(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            spellCheck={false}
            maxLength={7}
            aria-label="HEX 색 코드"
            aria-invalid={!draft}
            placeholder="#RRGGBB"
            className={cn(
              'h-8 min-w-0 flex-1 rounded-lg border bg-bg px-2 font-mono text-[12.5px] uppercase outline-none',
              draft ? 'border-line focus:border-accent' : 'border-danger',
            )}
          />
          <button
            type="button"
            disabled={!starTarget || (!starred && favorites.length >= MAX_FAVORITE_COLORS)}
            onClick={() => starTarget && toggleFavorite(starTarget)}
            aria-pressed={starred}
            aria-label={starred ? '즐겨찾기에서 빼기' : '즐겨찾기에 추가'}
            title={starred ? '즐겨찾기에서 빼기' : '즐겨찾기에 추가'}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-40',
              starred ? 'text-note' : 'text-fg-2',
            )}
          >
            <Star size={15} fill={starred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="submit"
            disabled={!draft}
            className="h-8 shrink-0 rounded-lg bg-accent px-2.5 text-[12.5px] font-medium text-accent-fg disabled:opacity-40"
          >
            적용
          </button>
        </form>
      </div>
    </div>
  );
}
