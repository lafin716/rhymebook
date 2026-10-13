import type { PopupWindow } from '@branch/core';
import { Columns2, Maximize2, X } from 'lucide-react';
import { Rnd } from 'react-rnd';
import { actions, useAppShallow } from '../app/store';
import { useUi } from '../app/uiState';
import { ChatPanel } from '../chat/ChatPanel';
import { IconButton } from '../components/Button';

/** 데스크톱/태블릿 플로팅 팝업 (드래그·리사이즈·다중) */
export function PopupLayer() {
  const popups = useAppShallow((s) => s.view.popups);
  if (!popups.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-live="polite">
      {popups.map((p) => (
        <PopupItem key={p.id} popup={p} />
      ))}
    </div>
  );
}

function PopupItem({ popup }: { popup: PopupWindow }) {
  // 사이드바에서 세션을 끄는 동안은 아래 패널의 놓기 영역을 가리지 않게 흐리게·통과시킨다
  const dragging = useUi((s) => !!s.dragSessionId);
  return (
    <Rnd
      position={{ x: popup.x, y: popup.y }}
      size={{ width: popup.w, height: popup.h }}
      minWidth={320}
      minHeight={260}
      bounds="parent"
      dragHandleClassName="popup-handle"
      cancel="button, select, a, input"
      style={{ zIndex: popup.z }}
      className={dragging ? 'pointer-events-none opacity-40 transition-opacity' : 'pointer-events-auto'}
      onMouseDown={() => actions().focusPopup(popup.id)}
      onDragStop={(_, d) => actions().movePopup(popup.id, { x: d.x, y: d.y })}
      onResizeStop={(_, __, ref, ___, pos) =>
        actions().movePopup(popup.id, { w: ref.offsetWidth, h: ref.offsetHeight, x: pos.x, y: pos.y })
      }
    >
      <div className="animate-pop-in h-full overflow-hidden rounded-2xl border border-line-strong bg-bg shadow-float" role="dialog" aria-label="가지 팝업">
        <ChatPanel
          sessionId={popup.sessionId}
          variant="popup"
          handleClassName="popup-handle cursor-grab active:cursor-grabbing"
          headerActions={
            <span className="flex shrink-0 items-center">
              <IconButton size="sm" label="분할로 도킹" onClick={() => actions().dockPopup(popup.id)}>
                <Columns2 size={15} />
              </IconButton>
              <IconButton
                size="sm"
                label="메인에서 열기"
                onClick={() => {
                  actions().closePopup(popup.id);
                  actions().openSession(popup.sessionId, 'main');
                }}
              >
                <Maximize2 size={15} />
              </IconButton>
              <IconButton size="sm" label="닫기" onClick={() => actions().closePopup(popup.id)}>
                <X size={16} />
              </IconButton>
            </span>
          }
        />
      </div>
    </Rnd>
  );
}
