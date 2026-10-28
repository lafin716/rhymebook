import type { CanvasFlow, CanvasLayout } from "@branch/core";
import { ArrowLeftRight, ArrowUpDown, Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ImportDialog } from "./CanvasImport";

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

const OPTION =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-fg hover:bg-surface-2 md:min-h-9";

/** 캔버스 설정: 판 크기(자유·가로형·세로형)와 쪽 넘김 방향 고르기 */
export function CanvasSettings({
  layout,
  onLayout,
  flow,
  onFlow,
  onClose,
}: {
  layout: CanvasLayout;
  onLayout(layout: CanvasLayout): void;
  flow: CanvasFlow;
  onFlow(flow: CanvasFlow): void;
  onClose(): void;
}) {
  return (
    <ImportDialog label="캔버스 설정" title="캔버스 설정" onClose={onClose}>
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
                className={cn(OPTION, on && "bg-accent-soft hover:bg-accent-soft")}
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
                    className={cn(OPTION, on && "bg-accent-soft hover:bg-accent-soft")}
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
    </ImportDialog>
  );
}
