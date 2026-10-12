import type { ID } from '@branch/core';
import { memo, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { openBranch } from './open';

interface RegionBar {
  sessionId: ID;
  top: number;
  height: number;
  lane: number;
}

/**
 * 여러 블록에 걸친 가지(mark[data-region])를 메시지 왼쪽 여백의 세로 막대로 표시한다 (ADR-030).
 * 막대 hover → 범위 강조, 클릭 → 가지 열기. 겹치는 막대는 lane으로 나란히 놓는다.
 */
export const RegionGutter = memo(function RegionGutter({ target }: { target: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<RegionBar[]>([]);

  useLayoutEffect(() => {
    const container = target.current;
    const box = ref.current?.parentElement;
    if (!container || !box) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const base = box.getBoundingClientRect();
        const spans = new Map<ID, { top: number; bottom: number }>();
        for (const mark of container.querySelectorAll<HTMLElement>('mark.anchor[data-region="true"]')) {
          const id = mark.dataset.sessionId;
          if (!id) continue;
          const r = mark.getBoundingClientRect();
          if (!r.height) continue;
          const cur = spans.get(id);
          spans.set(id, {
            top: Math.min(cur?.top ?? Infinity, r.top - base.top),
            bottom: Math.max(cur?.bottom ?? -Infinity, r.bottom - base.top),
          });
        }
        const sorted = [...spans].sort((a, b) => a[1].top - b[1].top);
        const laneEnds: number[] = [];
        const next: RegionBar[] = sorted.map(([sessionId, s]) => {
          let lane = laneEnds.findIndex((end) => end <= s.top);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = s.bottom;
          return { sessionId, top: s.top, height: s.bottom - s.top, lane };
        });
        setBars((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    const mo = new MutationObserver(measure);
    mo.observe(container, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [target]);

  const setActive = (id: ID, on: boolean) => {
    target.current?.querySelectorAll<HTMLElement>(`mark.anchor[data-session-id="${CSS.escape(id)}"]`).forEach((m) => {
      if (on) m.dataset.active = 'true';
      else delete m.dataset.active;
    });
  };

  return (
    <div ref={ref} aria-hidden={bars.length ? undefined : true} className="anchor-gutter">
      {bars.map((bar) => (
        <button
          key={bar.sessionId}
          type="button"
          aria-label="여러 줄 가지 열기"
          title="여러 줄 가지 열기"
          data-region-bar={bar.sessionId}
          className="anchor-region"
          style={{ top: bar.top, height: bar.height, left: -12 - bar.lane * 6 }}
          onMouseEnter={() => setActive(bar.sessionId, true)}
          onMouseLeave={() => setActive(bar.sessionId, false)}
          onClick={(e) => {
            e.stopPropagation();
            setActive(bar.sessionId, false);
            openBranch(bar.sessionId);
          }}
        />
      ))}
    </div>
  );
});
