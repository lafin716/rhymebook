import {
  CANVAS_PAPER,
  type CanvasBackground,
  type CanvasFlow,
  type CanvasLayout,
  type CanvasPattern,
} from "@branch/core";
import { ArrowLeftRight, ArrowUpDown, Check, FileType2 } from "lucide-react";
import { GESTURE_ACTIONS, GESTURE_KEYS, type GestureAction, type GestureKey, type GestureMap } from "./canvasPrefs";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ImportDialog } from "./CanvasImport";
import { backgroundStyle, getBgColors } from "./canvasBackground";
import { t } from "../i18n";

function layoutOptions(): { layout: CanvasLayout; label: string; hint: string; box: { w: number; h: number } | null }[] {
  return [
    { layout: "free", label: t("canvas.settings.layout.free.label"), hint: t("canvas.settings.layout.free.hint"), box: null },
    {
      layout: "landscape",
      label: t("canvas.settings.layout.landscape.label"),
      hint: t("canvas.settings.layout.landscape.hint"),
      box: { w: 32, h: 18 },
    },
    {
      layout: "portrait",
      label: t("canvas.settings.layout.portrait.label"),
      hint: t("canvas.settings.layout.portrait.hint"),
      box: { w: 18, h: 32 },
    },
    {
      layout: "a4-landscape",
      label: t("canvas.settings.layout.a4Landscape.label"),
      hint: t("canvas.settings.layout.a4Landscape.hint"),
      box: { w: 32, h: 23 },
    },
    {
      layout: "a4-portrait",
      label: t("canvas.settings.layout.a4Portrait.label"),
      hint: t("canvas.settings.layout.a4Portrait.hint"),
      box: { w: 23, h: 32 },
    },
  ];
}

function patternOptions(): { pattern: CanvasPattern | undefined; label: string }[] {
  return [
    { pattern: undefined, label: t("canvas.settings.pattern.none") },
    { pattern: "grid-fine", label: t("canvas.settings.pattern.gridFine") },
    { pattern: "grid-wide", label: t("canvas.settings.pattern.gridWide") },
    { pattern: "lines", label: t("canvas.settings.pattern.lines") },
  ];
}

function flowOptions(): { flow: CanvasFlow; label: string; hint: string; icon: ReactNode }[] {
  return [
    {
      flow: "horizontal",
      label: t("canvas.settings.flow.horizontal.label"),
      hint: t("canvas.settings.flow.horizontal.hint"),
      icon: <ArrowLeftRight size={18} />,
    },
    {
      flow: "vertical",
      label: t("canvas.settings.flow.vertical.label"),
      hint: t("canvas.settings.flow.vertical.hint"),
      icon: <ArrowUpDown size={18} />,
    },
  ];
}

function gestureLabels(): Record<GestureKey, string> {
  return {
    "double-tap": t("canvas.settings.gesture.doubleTap"),
    "swipe-up": t("canvas.settings.gesture.swipeUp"),
    "swipe-down": t("canvas.settings.gesture.swipeDown"),
    "swipe-left": t("canvas.settings.gesture.swipeLeft"),
    "swipe-right": t("canvas.settings.gesture.swipeRight"),
  };
}

function actionLabels(): Record<GestureAction, string> {
  return {
    off: t("canvas.settings.action.off"),
    "select-pen": t("canvas.settings.action.selectPen"),
    "eraser-pen": t("canvas.settings.action.eraserPen"),
    "pen-marker": t("canvas.settings.action.penMarker"),
    undo: t("canvas.settings.action.undo"),
    redo: t("canvas.settings.action.redo"),
    "prev-page": t("canvas.settings.action.prevPage"),
    "next-page": t("canvas.settings.action.nextPage"),
  };
}

const GESTURE_SELECT =
  "h-10 w-40 shrink-0 rounded-lg border border-line bg-bg px-2 text-[14px] text-fg outline-none focus:border-accent md:h-9";

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
  gestures,
  onGestures,
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
  /** 두 손가락 손동작마다 할 일 (기기별) */
  gestures: GestureMap;
  onGestures(g: GestureMap): void;
  onClose(): void;
}) {
  const color = bg?.color ?? CANVAS_PAPER;
  const shownCount = Math.min(paletteCount ?? paletteTotal, paletteTotal);
  const layouts = layoutOptions();
  const patterns = patternOptions();
  const flows = flowOptions();
  const gestureLabel = gestureLabels();
  const actionLabel = actionLabels();
  const bgColors = getBgColors();
  return (
    <ImportDialog label={t("canvas.settings.title")} title={t("canvas.settings.title")} onClose={onClose}>
      {layout === "pdf" && (
        <div
          data-canvas-pdf-mode
          className="mx-1 mb-2 flex items-center gap-3 rounded-lg bg-accent-soft px-3 py-2"
        >
          <FileType2 size={18} className="shrink-0 text-accent" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] text-fg">{t("canvas.settings.pdfMode")}</span>
            <span className="truncate text-[12px] text-muted">
              {t("canvas.settings.pdfHint", { name: pdfName ?? "PDF" })}
            </span>
          </span>
        </div>
      )}
      <p className="px-3 pt-1 pb-2 text-[12px] text-muted">{t("canvas.settings.sizeTitle")}</p>
      <ul
        role="radiogroup"
        aria-label={t("canvas.settings.sizeTitle")}
        data-canvas-settings
        className="flex flex-col gap-1"
      >
        {layouts.map((o) => {
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
          <p className="px-3 pt-3 pb-2 text-[12px] text-muted">{t("canvas.settings.flowTitle")}</p>
          <ul
            role="radiogroup"
            aria-label={t("canvas.settings.flowTitle")}
            className="flex flex-col gap-1"
          >
            {flows.map((o) => {
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
        {layout === "pdf" ? t("canvas.settings.bgPdf") : t("canvas.settings.bg")}
      </p>
      <div
        role="radiogroup"
        aria-label={t("canvas.settings.bgColor")}
        className="flex flex-wrap items-center gap-2 px-3"
      >
        {bgColors.map((c) => {
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
          title={t("canvas.settings.colorCustom")}
          className={cn(
            "relative grid size-11 cursor-pointer place-items-center rounded-full md:size-9",
            !bgColors.some((c) => c.hex === color) &&
              "ring-2 ring-accent ring-offset-2 ring-offset-surface",
          )}
        >
          <span
            className="size-8 rounded-full border border-line md:size-7"
            style={{
              background: bgColors.some((c) => c.hex === color)
                ? "conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#c084fc,#f87171)"
                : color,
            }}
          />
          <input
            type="color"
            aria-label={t("canvas.settings.colorCustom")}
            data-canvas-bg-custom
            value={color}
            onChange={(e) => onBackground({ ...bg, color: e.target.value })}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <ul
        role="radiogroup"
        aria-label={t("canvas.settings.bgPattern")}
        className="mt-2 grid grid-cols-2 gap-1"
      >
        {patterns.map((o) => {
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
      <p className="px-3 pt-3 pb-2 text-[12px] text-muted">{t("canvas.settings.paletteTitle")}</p>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <input
          type="range"
          min={1}
          max={paletteTotal}
          value={shownCount}
          aria-label={t("canvas.settings.paletteSlider")}
          onChange={(e) => {
            const n = Number(e.target.value);
            onPaletteCount(n >= paletteTotal ? null : n);
          }}
          className="h-2 w-full accent-[var(--accent)]"
        />
        <div className="flex items-center justify-between text-[13px] text-fg-2">
          <span>{t("canvas.settings.paletteMin")}</span>
          <span className="font-mono" data-palette-count>{paletteCount === null ? t("canvas.settings.paletteAll", { total: paletteTotal }) : `${shownCount} / ${paletteTotal}`}</span>
        </div>
      </div>
      <p className="px-3 pt-1 text-[12px] text-muted">{t("canvas.settings.gestureTitle")}</p>
      <p className="px-3 pb-2 text-[12px] text-muted">{t("canvas.settings.gestureHint")}</p>
      <ul aria-label={t("canvas.settings.gestureTitle")} className="flex flex-col gap-1 pb-1">
        {GESTURE_KEYS.map((k) => (
          <li key={k} className="flex min-h-11 items-center gap-3 px-3 md:min-h-9">
            <span className="min-w-0 flex-1 text-[14px] text-fg">{gestureLabel[k]}</span>
            <select
              value={gestures[k]}
              aria-label={t("canvas.settings.gestureSelect", { name: gestureLabel[k] })}
              data-canvas-gesture={k}
              onChange={(e) => onGestures({ ...gestures, [k]: e.target.value as GestureAction })}
              className={GESTURE_SELECT}
            >
              {GESTURE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {actionLabel[a]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </ImportDialog>
  );
}
