import { ChevronDown, Maximize2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { actions, useAppShallow } from '../app/store';
import { ChatPanel } from '../chat/ChatPanel';
import { IconButton } from '../components/Button';

/** 모바일 바텀시트 스택. 가장 위 시트만 보이고, 아래로 끌어 닫는다 */
export function SheetStack() {
  const ids = useAppShallow((s) => s.view.sheetSessionIds);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const top = ids[ids.length - 1];
  if (!top) return null;

  const end = () => {
    if (dy > 120) actions().closeSheet();
    setDy(0);
    start.current = null;
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="시트 닫기" className="animate-fade-in absolute inset-0 bg-black/40" onClick={() => actions().closeAllSheets()} />
      <div
        key={top}
        role="dialog"
        aria-label="가지 시트"
        className="animate-sheet-up relative flex h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-bg shadow-float"
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: start.current === null ? 'transform 180ms' : undefined }}
      >
        <div
          className="flex shrink-0 touch-none justify-center pt-2 pb-1"
          onPointerDown={(e) => {
            start.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current !== null && setDy(Math.max(0, e.clientY - start.current))}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="h-1.5 w-10 rounded-full bg-line-strong" />
        </div>
        {ids.length > 1 && (
          <div className="shrink-0 px-4 pb-1 text-[11.5px] text-muted">시트 {ids.length}개 겹침 · 아래로 내리면 이전 가지로</div>
        )}
        <ChatPanel
          sessionId={top}
          variant="sheet"
          className="min-h-0 flex-1"
          headerActions={
            <span className="flex shrink-0 items-center">
              <IconButton size="sm" label="전체 화면으로" onClick={() => actions().openSession(top, 'main')}>
                <Maximize2 size={15} />
              </IconButton>
              <IconButton size="sm" label="시트 닫기" onClick={() => actions().closeSheet()}>
                <ChevronDown size={18} />
              </IconButton>
            </span>
          }
        />
      </div>
    </div>,
    document.body,
  );
}
