import type { PointerEvent as ReactPointerEvent } from 'react';

export interface DragHandlers {
  /** 끌기가 시작됐다 (이 뒤로 move가 온다) */
  onStart(x: number, y: number): void;
  onMove(x: number, y: number): void;
  onDrop(x: number, y: number): void;
  onCancel(): void;
}

/** 터치로 길게 누르는 시간 (ms) */
const LONG_PRESS = 350;

/**
 * 포인터 끌기 (ADR-058). 마우스·펜은 몇 px 움직이면 시작하고, 터치는 길게 누른 뒤 시작한다
 * (그 전에 움직이면 스크롤로 둔다). handle: 손잡이처럼 touch-action:none인 곳 — 터치도 바로 시작.
 * 끄는 동안 스크롤·길게 누르기 메뉴를 막고, 놓은 직후의 click은 삼킨다. Esc로 취소
 */
export function beginDrag(e: ReactPointerEvent, h: DragHandlers, opts: { handle?: boolean } = {}) {
  if (e.button !== 0) return;
  const id = e.pointerId;
  const sx = e.clientX;
  const sy = e.clientY;
  const press = e.pointerType === 'touch' && !opts.handle;
  let x = sx;
  let y = sy;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const block = (ev: Event) => {
    if (ev.cancelable) ev.preventDefault();
  };
  const start = () => {
    active = true;
    document.addEventListener('touchmove', block, { passive: false });
    document.addEventListener('contextmenu', block);
    document.addEventListener('selectstart', block);
    h.onStart(x, y);
    h.onMove(x, y);
  };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    x = ev.clientX;
    y = ev.clientY;
    if (active) return h.onMove(x, y);
    const dist = Math.hypot(x - sx, y - sy);
    if (press) {
      if (dist > 8) cleanup();
    } else if (dist > (opts.handle ? 3 : 6)) start();
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (active) {
      h.onDrop(ev.clientX, ev.clientY);
      // 놓은 자리에서 생기는 click은 버린다
      const swallow = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    cleanup();
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (active) h.onCancel();
    cleanup();
  };
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !active) return;
    ev.stopPropagation();
    h.onCancel();
    cleanup();
  };
  function cleanup() {
    clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', esc, true);
    document.removeEventListener('touchmove', block);
    document.removeEventListener('contextmenu', block);
    document.removeEventListener('selectstart', block);
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', esc, true);
  if (press) {
    timer = setTimeout(() => {
      navigator.vibrate?.(12);
      start();
    }, LONG_PRESS);
  }
}

/** 끌기 중 손가락·커서 밑의 요소 (끌기 미리보기는 pointer-events:none이라 걸리지 않는다) */
export function pointTarget<T extends Element = HTMLElement>(x: number, y: number, selector: string): T | null {
  return (document.elementFromPoint(x, y)?.closest(selector) as T | null) ?? null;
}

/** 끄는 동안 스크롤 영역 가장자리에 닿으면 그쪽으로 천천히 스크롤한다 */
export function edgeScroller(el: HTMLElement | null) {
  let y = -1;
  let raf = 0;
  const tick = () => {
    if (el && y >= 0) {
      const r = el.getBoundingClientRect();
      const edge = Math.min(48, r.height / 4);
      if (y < r.top + edge) el.scrollTop -= Math.ceil(((r.top + edge - y) / edge) * 14);
      else if (y > r.bottom - edge) el.scrollTop += Math.ceil(((y - (r.bottom - edge)) / edge) * 14);
    }
    raf = requestAnimationFrame(tick);
  };
  return {
    update(nextY: number) {
      y = nextY;
      if (!raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      y = -1;
    },
  };
}
