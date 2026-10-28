import { canvasPageRects, type CanvasDoc, type ID } from '@branch/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasBoard } from './CanvasBoard';
import { createPresentChannel } from './presentChannel';
import { centerView, fitView, type CanvasView } from './view';

export interface PresentAudienceProps {
  sessionId: ID;
}

/**
 * 청중 화면 (ADR-089). 도구 막대 없이 발표자의 쪽·임시 필기·레이저 포인터만 보인다.
 * 발표자가 아직 없거나 끝냈으면 기다림 안내를 띄우고 hello를 다시 보낸다.
 */
export function PresentAudience({ sessionId }: PresentAudienceProps) {
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [page, setPage] = useState(0);
  const [ink, setInk] = useState<CanvasDoc['strokes']>([]);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [ended, setEnded] = useState(false);
  const [view, setView] = useState<CanvasView | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const channel = createPresentChannel(sessionId);
    let live = false;
    const off = channel.onMessage((msg) => {
      if (msg.type === 'doc' && msg.doc) {
        live = true;
        setDoc(msg.doc);
        setEnded(false);
      } else if (msg.type === 'page' && typeof msg.page === 'number') setPage(msg.page);
      else if (msg.type === 'ink' && msg.items) setInk(msg.items);
      else if (msg.type === 'laser') setLaser(msg.p ?? null);
      else if (msg.type === 'end') {
        live = false;
        setEnded(true);
        setLaser(null);
        setInk([]);
      }
    });
    // 발표자가 답할 때까지 1초마다 인사한다
    channel.send({ type: 'hello' });
    const timer = window.setInterval(() => {
      if (!live) channel.send({ type: 'hello' });
    }, 1000);
    return () => {
      window.clearInterval(timer);
      off();
      channel.close();
    };
  }, [sessionId]);

  const pageRects = useMemo(() => (doc ? canvasPageRects(doc) : []), [doc]);

  // 쪽(또는 자유 판 가운데)에 맞춘다 — 쪽이 바뀌거나 창 크기가 바뀔 때
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !doc) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const rect = pageRects[page];
      setView(rect ? fitView(rect, r.width, r.height, 16) : centerView(r.width, r.height));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc, page, pageRects]);

  const shown = useMemo(() => (doc ? { ...doc, strokes: [...doc.strokes, ...ink] } : null), [doc, ink]);
  const waiting = !shown || ended;

  return (
    <div data-present-audience className="fixed inset-0 bg-neutral-900">
      <div ref={wrapRef} className="absolute inset-0 flex flex-col">
        {shown && view && !ended && (
          <CanvasBoard
            boardRef={boardRef}
            doc={shown}
            view={view}
            onView={(fn) => setView((v) => (v ? fn(v) : v))}
            tool="select"
            color="#000000"
            size={0}
            nib="fountain"
            selectedId={null}
            onSelect={() => {}}
            onCommit={() => {}}
            pages={pageRects}
            readOnly
            laser={laser}
          />
        )}
      </div>
      {waiting && (
        <div className="absolute inset-0 grid place-items-center text-lg text-white/80">
          {ended ? '발표가 끝났어요' : '발표를 기다리는 중…'}
        </div>
      )}
    </div>
  );
}
