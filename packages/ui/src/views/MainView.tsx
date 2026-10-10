import { useApp } from '../app/store';
import { ChatPanel } from '../chat/ChatPanel';
import { NoSessions } from '../chat/EmptyChat';
import { MindmapView } from './MindmapView';
import { SplitView } from './SplitView';

/** 보기 모드에 따라 단일 채팅 / 분할 / 마인드맵을 고른다 */
export function MainView() {
  const mode = useApp((s) => s.view.mode);
  const activeId = useApp((s) => s.view.activeSessionId);
  const exists = useApp((s) => (activeId ? !!s.sessions[activeId] : false));
  const splitCount = useApp((s) => s.view.splitSessionIds.length);

  if (!exists) return <NoSessions />;
  if (mode === 'split' && splitCount > 0) return <SplitView />;
  if (mode === 'mindmap') return <MindmapView />;
  return <ChatPanel key={activeId!} sessionId={activeId!} variant="main" className="h-full" />;
}
