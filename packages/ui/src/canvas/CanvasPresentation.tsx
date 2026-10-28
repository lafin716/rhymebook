import { canvasPageRects, type CanvasDoc, type ID } from '@branch/core';
import { ChevronLeft, ChevronRight, Eraser, Maximize, MonitorUp, MousePointer2, Pen, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { desktop, mobile } from '../app/runtime';
import { cn } from '../lib/cn';
import { CanvasBoard } from './CanvasBoard';
import { INK_COLORS } from './CanvasToolbar';
import { createPresentChannel, type PresentChannel, type PresentMessage } from './presentChannel';
import { centerView, fitView, type CanvasView } from './view';

export interface CanvasPresentationProps {
  sessionId: ID;
  doc: CanvasDoc;
  page: number;
  onExit(): void;
}

type PresentTool = 'pointer' | 'pen' | 'eraser';
type Point = { x: number; y: number };

const PEN_COLORS = INK_COLORS.slice(0, 5).map((c) => c.hex);

/**
 * 발표 모드 (ADR-089). 화면 전체를 덮고 레이저 포인터·펜·지우개·쪽 넘김을 준다.
 * 발표 필기는 임시(문서에 저장 안 함, 끝내면 사라짐). '발표 화면 열기'로 연 청중 창은
 * 도구 막대 없이 같은 쪽·필기·포인터를 실시간으로 받는다.
 */
export function CanvasPresentation({ sessionId, doc, page: initialPage, onExit }: CanvasPresentationProps) {
  const pageRects = useMemo(() => canvasPageRects(doc), [doc]);
  const isFree = pageRects.length === 0;
  const [page, setPage] = useState(() => Math.max(0, Math.min(initialPage, pageRects.length - 1)));
  const [tool, setTool] = useState<PresentTool>('pointer');
  const [color, setColor] = useState(PEN_COLORS[1] ?? '#e5484d');
  const [ink, setInk] = useState<CanvasDoc['strokes']>([]);
  const [laser, setLaser] = useState<Point | null>(null);
  const [view, setView] = useState<CanvasView | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const baseIds = useMemo(() => new Set(doc.strokes.map((s) => s.id)), [doc]);
  const shown: CanvasDoc = useMemo(() => ({ ...doc, strokes: [...doc.strokes, ...ink] }), [doc, ink]);

  // 청중 창과의 채널 — 최신 상태는 ref로 두고 hello에 답한다
  const channelRef = useRef<PresentChannel | null>(null);
  const send = (msg: PresentMessage) => channelRef.current?.send(msg);
  const state = useRef({ doc, page, ink });
  state.current = { doc, page, ink };
  const audienceOpen = useRef(false);
  useEffect(() => {
    const channel = createPresentChannel(sessionId);
    channelRef.current = channel;
    const off = channel.onMessage((msg: PresentMessage) => {
      if (msg.type !== 'hello') return;
      const s = state.current;
      channel.send({ type: 'doc', doc: s.doc });
      channel.send({ type: 'page', page: s.page });
      channel.send({ type: 'ink', items: s.ink });
    });
    return () => {
      off();
      channel.send({ type: 'end' });
      channel.close();
      channelRef.current = null;
      if (audienceOpen.current) desktop?.windows?.present?.close();
    };
  }, [sessionId]);
  useEffect(() => send({ type: 'doc', doc }), [doc]);
  useEffect(() => send({ type: 'page', page }), [page]);
  useEffect(() => send({ type: 'ink', items: ink }), [ink]);

  // 레이저는 프레임마다 한 번만 보낸다
  const laserFrame = useRef<{ raf: number; p: Point | null } | null>(null);
  const moveLaser = (p: Point | null) => {
    setLaser(p);
    if (laserFrame.current) {
      laserFrame.current.p = p;
      return;
    }
    const f = { raf: 0, p };
    f.raf = requestAnimationFrame(() => {
      laserFrame.current = null;
      send({ type: 'laser', p: f.p });
    });
    laserFrame.current = f;
  };
  useEffect(() => () => {
    if (laserFrame.current) cancelAnimationFrame(laserFrame.current.raf);
  }, []);

  // 쪽(또는 자유 판 가운데)에 맞춘다 — 처음, 쪽이 바뀔 때, 화면 크기가 바뀔 때
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const rect = pageRects[page];
      setView(rect ? fitView(rect, r.width, r.height, 16) : centerView(r.width, r.height));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page, pageRects]);

  const go = (delta: number) => {
    if (isFree) return;
    setPage((p) => Math.max(0, Math.min(p + delta, pageRects.length - 1)));
  };

  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitRef.current();
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        goRef.current(-1);
      } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        goRef.current(1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 끝낼 때 브라우저 전체 화면도 푼다
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  const openAudience = () => {
    const present = desktop?.windows?.present;
    if (present) {
      present.open(sessionId);
      audienceOpen.current = true;
      return;
    }
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ window: 'present', session: sessionId }).toString();
    url.hash = '';
    window.open(url.toString(), `octobooks-present-${sessionId}`);
  };

  // 발표 필기만 바꾼다 — 지우개가 원본 획을 지워도 무시한다
  const commit = (next: CanvasDoc) => setInk(next.strokes.filter((s) => !baseIds.has(s.id)));

  const btn = (active: boolean) =>
    cn(
      'grid size-10 shrink-0 place-items-center rounded-lg transition-colors',
      active ? 'bg-white text-black' : 'text-white hover:bg-white/15',
    );

  return (
    <div ref={rootRef} data-canvas-presentation className="fixed inset-0 z-[60] flex flex-col bg-neutral-900">
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {view && (
          <CanvasBoard
            boardRef={boardRef}
            doc={shown}
            view={view}
            onView={(fn) => setView((v) => (v ? fn(v) : v))}
            tool={tool === 'eraser' ? 'eraser' : 'pen'}
            color={color}
            size={tool === 'eraser' ? 16 : 3}
            nib="fountain"
            selectedId={null}
            onSelect={() => {}}
            onCommit={commit}
            pages={pageRects}
            panAxis={isFree ? null : doc.flow === 'vertical' ? 'y' : 'x'}
            pointer={tool === 'pointer'}
            onPointer={moveLaser}
            laser={tool === 'pointer' ? laser : null}
          />
        )}
      </div>

      <div
        role="toolbar"
        aria-label="발표 도구"
        data-present-toolbar
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-black/80 p-1.5 shadow-lg backdrop-blur">
          <button type="button" aria-label="레이저 포인터" aria-pressed={tool === 'pointer'} className={btn(tool === 'pointer')} onClick={() => setTool('pointer')}>
            <MousePointer2 className="size-5" />
          </button>
          <button type="button" aria-label="펜" aria-pressed={tool === 'pen'} className={btn(tool === 'pen')} onClick={() => setTool('pen')}>
            <Pen className="size-5" />
          </button>
          <button type="button" aria-label="지우개" aria-pressed={tool === 'eraser'} className={btn(tool === 'eraser')} onClick={() => setTool('eraser')}>
            <Eraser className="size-5" />
          </button>
          {tool === 'pen' &&
            PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`색 ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className="grid size-8 shrink-0 place-items-center"
              >
                <span className={cn('size-5 rounded-full border-2', color === c ? 'border-white' : 'border-white/30')} style={{ backgroundColor: c }} />
              </button>
            ))}
          <button type="button" aria-label="필기 모두 지우기" disabled={ink.length === 0} className={cn(btn(false), 'disabled:opacity-40')} onClick={() => setInk([])}>
            <Trash2 className="size-5" />
          </button>
          {!isFree && (
            <>
              <span className="mx-1 h-6 w-px shrink-0 bg-white/20" />
              <button type="button" aria-label="이전 쪽" disabled={page === 0} className={cn(btn(false), 'disabled:opacity-40')} onClick={() => go(-1)}>
                <ChevronLeft className="size-5" />
              </button>
              <span data-present-page className="shrink-0 px-1 text-sm tabular-nums text-white">
                {page + 1} / {pageRects.length}
              </span>
              <button type="button" aria-label="다음 쪽" disabled={page >= pageRects.length - 1} className={cn(btn(false), 'disabled:opacity-40')} onClick={() => go(1)}>
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
          <span className="mx-1 h-6 w-px shrink-0 bg-white/20" />
          {!mobile && (
            <button type="button" aria-label="발표 화면 열기" title="발표 화면 열기 (청중용, 도구 막대 없음)" className={btn(false)} onClick={openAudience}>
              <MonitorUp className="size-5" />
            </button>
          )}
          {!desktop && !mobile && (
            <button type="button" aria-label="화면 가득" className={btn(false)} onClick={fullscreen}>
              <Maximize className="size-5" />
            </button>
          )}
          <button type="button" aria-label="발표 끝내기" title="발표 끝내기 (Esc)" className={btn(false)} onClick={onExit}>
            <X className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
