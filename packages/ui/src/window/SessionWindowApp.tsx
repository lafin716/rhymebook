import { Laptop, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useApp } from '../app/store';
import { syncClient, useSync } from '../app/sync';
import { useBreakpoint } from '../app/useBreakpoint';
import { useThemeSync } from '../app/useTheme';
import { SelectionMenu } from '../chat/SelectionMenu';
import { ConfirmHost } from '../components/ConfirmDialog';
import { Toasts } from '../components/Toasts';
import { MainView } from '../views/MainView';
import { PopupLayer } from '../views/PopupLayer';
import { SheetStack } from '../views/SheetStack';

/**
 * 세션 창 (ADR-036): 사이드바·상단 바 없이 한 세션의 채팅만 보여 준다.
 * 데이터는 메인 창을 미러링하고, 질문·가지 등은 메인 창이 실행한다.
 */
export function SessionWindowApp() {
  useThemeSync();
  const bp = useBreakpoint();
  const status = useSync((s) => s.status);
  const title = useApp((s) => (s.view.activeSessionId ? s.sessions[s.view.activeSessionId]?.title : undefined));
  const exists = useApp((s) => (s.view.activeSessionId ? !!s.sessions[s.view.activeSessionId] : false));

  useEffect(() => {
    document.title = title ? `${title} — rhymebook` : 'rhymebook';
  }, [title]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <main className="relative min-h-0 flex-1">{status === 'online' && exists ? <MainView /> : <WindowStatus online={status === 'online'} />}</main>
      {bp === 'mobile' ? <SheetStack /> : <PopupLayer />}
      <SelectionMenu />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

/** 메인 창과 연결 중·끊김, 또는 세션이 삭제됨 */
function WindowStatus({ online }: { online: boolean }) {
  const status = useSync((s) => s.status);
  const [head, body] = online
    ? ['세션을 찾을 수 없어요', '삭제되었거나 메인 창에서 사라진 세션이에요. 이 창을 닫아 주세요.']
    : status === 'offline'
      ? ['메인 창과 연결이 끊겼어요', 'rhymebook 메인 창이 열려 있는지 확인하세요.']
      : ['불러오는 중', '메인 창에서 세션을 가져오고 있어요.'];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Laptop size={28} className={status === 'connecting' ? 'animate-pulse' : undefined} />
      </div>
      <h2 className="text-[19px] font-semibold">{head}</h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">{body}</p>
      {status === 'offline' && (
        <button
          type="button"
          onClick={() => syncClient?.reconnect()}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg"
        >
          <RefreshCw size={16} />
          다시 연결
        </button>
      )}
    </div>
  );
}
