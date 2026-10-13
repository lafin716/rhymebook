import { useApp } from '../app/store';
import { ChatPanel } from '../chat/ChatPanel';
import { NoSessions } from '../chat/EmptyChat';
import { DropZone } from './DropZone';
import { MindmapView } from './MindmapView';
import { SplitView } from './SplitView';

/** 보기 모드에 따라 단일 채팅 / 분할 / 마인드맵을 고른다. 분할은 사이드바에서 세션을 끌어 놓아 만든다 */
export function MainView() {
  const mode = useApp((s) => s.view.mode);
  const activeId = useApp((s) => s.view.activeSessionId);
  const exists = useApp((s) => (activeId ? !!s.sessions[activeId] : false));
  const splitCount = useApp((s) => s.view.splitSessionIds.length);

  if (!exists) return <NoSessions />;
  if (mode === 'split' && splitCount > 1) return <SplitView />;
  if (mode === 'mindmap') return <MindmapView />;
  return (
    <div className="relative h-full" data-split-pane={activeId}>
      <ChatPanel key={activeId!} sessionId={activeId!} variant="main" className="h-full" />
      <DropZone targetId={activeId!} />
    </div>
  );
}
