import {
  CANVAS_PAPER,
  type CanvasBackground,
  type CanvasFlow,
  type CanvasLayout,
  type CanvasPattern,
} from "@branch/core";
import { ArrowLeftRight, ArrowUpDown, Check, FileType2 } from "lucide-react";
import type { TwoFingerDoubleTap } from "./canvasPrefs";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ImportDialog } from "./CanvasImport";
import { backgroundStyle, BG_COLORS } from "./canvasBackground";

const LAYOUTS: {
  layout: CanvasLayout;
  label: string;
  hint: string;
  box: { w: number; h: number } | null;
}[] = [
  { layout: "free", label: "자유", hint: "끝없는 판에 어디든 쓰기", box: null },
  {
    layout: "landscape",
    label: "가로형 16:9",
    hint: "쪽마다 가로로 넓게 · 넘겨서 새 쪽",
    box: { w: 32, h: 18 },
  },
  {
    layout: "portrait",
    label: "세로형 9:16",
    hint: "쪽마다 세로로 길게 · 넘겨서 새 쪽",
    box: { w: 18, h: 32 },
  },
  {
    layout: "a4-landscape",
    label: "A4 가로",
    hint: "A4 종이를 눕힌 쪽 · 넘겨서 새 쪽",
    box: { w: 32, h: 23 },
  },
  {
    layout: "a4-portrait",
    label: "A4 세로",
    hint: "A4 종이를 세운 쪽 · 넘겨서 새 쪽",
    box: { w: 23, h: 32 },
  },
];

const PATTERNS: { pattern: CanvasPattern | undefined; label: string }[] = [
  { pattern: undefined, label: "민무늬" },
  { pattern: "grid-fine", label: "바둑판 촘촘하게" },
  { pattern: "grid-wide", label: "바둑판 느슨하게" },
  { pattern: "lines", label: "줄공책" },
];

const FLOWS: { flow: CanvasFlow; label: string; hint: string; icon: ReactNode }[] = [
  {
    flow: "horizontal",
    label: "옆으로",
    hint: "좌우로 밀어 쪽 넘기기",
    icon: <ArrowLeftRight size={18} />,
  },
  {
    flow: "vertical",
    label: "위아래로",
    hint: "위아래로 밀어 쪽 넘기기",
    icon: <ArrowUpDown size={18} />,
  },
];

const TWO_FINGER: { action: TwoFingerDoubleTap; label: string; hint: string }[] = [
  { action: "select-pen", label: "선택 ↔ 펜", hint: "선택 도구와 마지막에 쓴 도구를 오가요" },
  { action: "eraser-pen", label: "지우개 ↔ 펜", hint: "지우개와 마지막에 쓴 펜·형광펜을 오가요" },
  { action: "undo", label: "실행 취소", hint: "방금 한 것을 되돌려요" },
  { action: "off", label: "끄기", hint: "아무것도 하지 않아요" },
];

const OPTION =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-fg hover:bg-surface-2 md:min-h-9";

/** 캔버스 설정: 판 크기(자유·16:9·9:16·A4 가로·세로, PDF 모드 표시), 쪽 넘김 방향, 바탕(색·무늬), 팔레트 개수 */
export function CanvasSettings({
  layout,
  onLayout,
  flow,
  onFlow,
  pdfName,
  bg,
  onBackground,
  paletteCount,
  onPaletteCount,
  paletteTotal,
  twoFingerTap,
  onTwoFingerTap,
  onClose,
}: {
  layout: CanvasLayout;
  onLayout(layout: CanvasLayout): void;
  flow: CanvasFlow;
  onFlow(flow: CanvasFlow): void;
  /** PDF 모드면 가져온 PDF 이름 */
  pdfName?: string;
  bg: CanvasBackground | undefined;
  onBackground(bg: CanvasBackground): void;
  paletteCount: number | null;
  onPaletteCount(n: number | null): void;
  /** 기본 색 + 즐겨찾는 색 수 */
  paletteTotal: number;
  /** 두 손가락으로 두 번 톡 쳤을 때 할 일 (기기별) */
  twoFingerTap: TwoFingerDoubleTap;
  onTwoFingerTap(a: TwoFingerDoubleTap): void;
  onClose(): void;
}) {
  const color = bg?.color ?? CANVAS_PAPER;
  const shownCount = Math.min(paletteCount ?? paletteTotal, paletteTotal);
  return (
    <ImportDialog label="캔버스 설정" title="캔버스 설정" onClose={onClose}>
      {layout === "pdf" && (
        <div
          data-canvas-pdf-mode
          className="mx-1 mb-2 flex items-center gap-3 rounded-lg bg-accent-soft px-3 py-2"
        >
          <FileType2 size={18} className="shrink-0 text-accent" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] text-fg">PDF 모드</span>
            <span className="truncate text-[12px] text-muted">
              {pdfName ?? "PDF"} · 아래에서 다른 크기를 고르면 PDF가 빠져요
            </span>
          </span>
        </div>
      )}
      <p className="px-3 pt-1 pb-2 text-[12px] text-muted">캔버스 크기</p>
      <ul
        role="radiogroup"
        aria-label="캔버스 크기"
        data-canvas-settings
        className="flex flex-col gap-1"
      >
        {LAYOUTS.map((o) => {
          const on = o.layout === layout;
          return (
            <li key={o.layout}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                data-canvas-layout={o.layout}
                onClick={() => onLayout(o.layout)}
                className={cn(OPTION, on && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center"
                  aria-hidden
                >
                  {o.box ? (
                    <span
                      className="rounded-[3px] border-2 border-current text-accent"
                      style={{ width: o.box.w, height: o.box.h }}
                    />
                  ) : (
                    <span className="size-8 rounded-[3px] border-2 border-dashed border-current text-accent" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px]">{o.label}</span>
                  <span className="text-[12px] text-muted">{o.hint}</span>
                </span>
                {on && <Check size={18} className="shrink-0 text-accent" />}
              </button>
            </li>
          );
        })}
      </ul>
      {layout !== "free" && (
        <>
          <p className="px-3 pt-3 pb-2 text-[12px] text-muted">쪽 넘김 방향</p>
          <ul
            role="radiogroup"
            aria-label="쪽 넘김 방향"
            className="flex flex-col gap-1"
          >
            {FLOWS.map((o) => {
              const on = o.flow === flow;
              return (
                <li key={o.flow}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-canvas-flow={o.flow}
                    onClick={() => onFlow(o.flow)}
                    className={cn(OPTION, on && 'bg-accent-soft hover:bg-accent-soft')}
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center text-accent"
                      aria-hidden
                    >
                      {o.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[14px]">{o.label}</span>
                      <span className="text-[12px] text-muted">{o.hint}</span>
                    </span>
                    {on && <Check size={18} className="shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="px-3 pt-3 pb-2 text-[12px] text-muted">
        바탕{layout === "pdf" && " · PDF 쪽 바깥과 새로 만드는 판에 보여요"}
      </p>
      <div
        role="radiogroup"
        aria-label="바탕색"
        className="flex flex-wrap items-center gap-2 px-3"
      >
        {BG_COLORS.map((c) => {
          const on = c.hex === color;
          return (
            <button
              key={c.hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              title={c.label}
              data-canvas-bg-color={c.hex}
              onClick={() => onBackground({ ...bg, color: c.hex })}
              className={cn(
                "grid size-11 place-items-center rounded-full md:size-9",
                on && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
              )}
            >
              <span
                className="size-8 rounded-full border border-line md:size-7"
                style={{ backgroundColor: c.hex }}
              />
            </button>
          );
        })}
        <label
          title="바탕색 직접 고르기"
          className={cn(
            "relative grid size-11 cursor-pointer place-items-center rounded-full md:size-9",
            !BG_COLORS.some((c) => c.hex === color) &&
              "ring-2 ring-accent ring-offset-2 ring-offset-surface",
          )}
        >
          <span
            className="size-8 rounded-full border border-line md:size-7"
            style={{
              background: BG_COLORS.some((c) => c.hex === color)
                ? "conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#c084fc,#f87171)"
                : color,
            }}
          />
          <input
            type="color"
            aria-label="바탕색 직접 고르기"
            data-canvas-bg-custom
            value={color}
            onChange={(e) => onBackground({ ...bg, color: e.target.value })}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <ul
        role="radiogroup"
        aria-label="바탕 무늬"
        className="mt-2 grid grid-cols-2 gap-1"
      >
        {PATTERNS.map((o) => {
          const on = o.pattern === bg?.pattern;
          return (
            <li key={o.label}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                data-canvas-bg-pattern={o.pattern ?? "none"}
                onClick={() => onBackground({ ...bg, pattern: o.pattern })}
                className={cn(OPTION, on && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <span
                  className="size-9 shrink-0 rounded-md border border-line"
                  style={backgroundStyle({ color, pattern: o.pattern }, 0.5)}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-[13px]">{o.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-3 pt-3 pb-2 text-[12px] text-muted">한 번에 보일 색 개수</p>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <input
          type="range"
          min={1}
          max={paletteTotal}
          value={shownCount}
          aria-label="팔레트 색 개수"
          onChange={(e) => {
            const n = Number(e.target.value);
            onPaletteCount(n >= paletteTotal ? null : n);
          }}
          className="h-2 w-full accent-[var(--accent)]"
        />
        <div className="flex items-center justify-between text-[13px] text-fg-2">
          <span>최소 1개</span>
          <span className="font-mono" data-palette-count>{paletteCount === null ? `모두 (${paletteTotal})` : `${shownCount} / ${paletteTotal}`}</span>
        </div>
      </div>
      <p className="px-3 pt-1 pb-2 text-[12px] text-muted">두 손가락으로 두 번 톡</p>
      <ul role="radiogroup" aria-label="두 손가락으로 두 번 톡" className="flex flex-col gap-1 pb-1">
        {TWO_FINGER.map((o) => {
          const on = o.action === twoFingerTap;
          return (
            <li key={o.action}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                data-two-finger-tap={o.action}
                title={o.hint}
                onClick={() => onTwoFingerTap(o.action)}
                className={cn(OPTION, on && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px]">{o.label}</span>
                  <span className="text-[12px] text-muted">{o.hint}</span>
                </span>
                {on && <Check size={18} className="shrink-0 text-accent" />}
              </button>
            </li>
          );
        })}
      </ul>
    </ImportDialog>
  );
}
