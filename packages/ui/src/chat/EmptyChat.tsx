import { OctoGarden } from '../components/OctoMark';
import type { ID } from '@branch/core';
import { Laptop, Link2, List, RefreshCw, Sparkles } from 'lucide-react';
import { remoteMode } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { syncClient, useRemoteHosts, useSync } from '../app/sync';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { HostList } from '../components/HostList';
import { usePcOnline } from '../components/PcStatus';

const SUGGESTIONS = ['바다는 왜 파랗게 보일까?', 'AI는 어떻게 말을 배울까?', '오늘 배운 것을 오래 기억하려면?'];

/** 메시지가 없는 세션의 첫 화면 */
export function EmptyChat({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const online = usePcOnline();
  return (
    <div className="octo-welcome mx-auto flex max-w-xl flex-col items-center rounded-3xl px-4 py-8 text-center sm:py-12">
      <OctoGarden />
      <span className="mb-3 text-[10px] font-semibold tracking-[.22em] text-accent">A LITTLE QUESTION. A NEW DIRECTION.</span>
      <h2 className="text-[18px] font-semibold">어떤 호기심부터 펼쳐볼까요?</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
        답변에서 모르는 단어를 <b className="font-medium text-fg-2">드래그</b>(모바일은 길게 누르기)하면
        <br className={compact ? 'hidden' : undefined} /> 그 자리에서 가지를 쳐서 물어볼 수 있어요.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={!online}
            onClick={() => actions().sendMessage(sessionId, q)}
            className="flex disabled:opacity-50 disabled:hover:border-line disabled:hover:text-fg-2 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[14px] text-fg-2 hover:border-line-strong hover:text-fg"
          >
            <Sparkles size={14} className="shrink-0 text-accent" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 세션이 하나도 없을 때. 원격 모드는 PC와 연결된 뒤에만 시작할 수 있다 */
export function NoSessions() {
  const online = usePcOnline();
  const hasSessions = useApp((s) => Object.keys(s.sessions).length > 0);
  const bp = useBreakpoint();
  if (remoteMode && !online) return <PcNotConnected />;
  const openList = () => {
    const ui = useUi.getState();
    if (bp !== 'desktop') ui.setDrawer(true);
    else if (ui.sidebarCollapsed) ui.toggleSidebar();
  };
  return (
    <div className="octo-welcome flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      <OctoGarden />
      <p className="mb-3 text-[11px] font-semibold tracking-[.22em] text-accent">나만의 배움, 끝없이 펼쳐지는 바다</p>
      <h2 className="text-[19px] font-semibold">
        {hasSessions ? '이어서 볼 학습을 골라 주세요' : remoteMode ? 'PC에 아직 학습 기록이 없어요' : '작은 호기심을, 더 깊은 배움으로.'}
      </h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">
        {hasSessions
          ? '학습 목록에서 하나를 열거나, 새 학습을 시작해 보세요.'
          : remoteMode
            ? '여기서 시작한 학습은 PC에 저장되고, 답변은 PC의 CLI가 만들어요.'
            : '문어의 팔처럼 질문에서 질문으로. 궁금한 문장을 골라 가지를 뻗고, 나만의 학습 지도를 만들어 보세요.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {hasSessions && (
          <button
            type="button"
            onClick={openList}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg"
          >
            <List size={16} />
            학습 목록 열기
          </button>
        )}
        <button
          type="button"
          onClick={() => actions().newRootSession()}
          className={
            hasSessions
              ? 'inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2'
              : 'inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg'
          }
        >
          새 학습 시작
        </button>
      </div>
      {remoteMode && <RemoteHosts />}
    </div>
  );
}

/** 원격 모드 메인 화면: 저장한 PC 목록에서 다른 PC로 전환한다 (ADR-063) */
function RemoteHosts() {
  const count = useRemoteHosts((s) => s.hosts.length);
  if (!count) return null;
  return (
    <div className="mt-8 flex w-full justify-center">
      <HostList />
    </div>
  );
}

/** 원격 모드: PC와 연결되지 않아 학습을 볼 수 없을 때 */
function PcNotConnected() {
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  const hasHosts = useRemoteHosts((s) => s.hosts.length > 0);
  const pc = hostName ?? 'PC';
  const copy = {
    unpaired: hasHosts
      ? ['연결할 PC를 골라 주세요', '저장해 둔 PC를 누르면 그 PC의 학습을 보고 이어서 질문할 수 있어요.']
      : ['PC와 연결해 주세요', 'octobooks PC 앱과 페어링하면 PC에서 학습 중인 내용을 여기서 보고 이어서 질문할 수 있어요.'],
    connecting: [`${pc}에 연결하는 중`, 'PC의 학습 목록을 불러오고 있어요.'],
    offline: [`${pc}와 연결이 끊겼어요`, 'PC 앱이 켜져 있고 원격 페어링이 열려 있는지 확인하세요.'],
    unsupported: ['PC 앱 업데이트가 필요해요', 'PC의 octobooks 앱을 최신 버전으로 업데이트하면 원격 학습을 쓸 수 있어요.'],
    online: ['', ''],
  }[status];
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      <div className="mb-4 flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Laptop size={28} className={status === 'connecting' ? 'animate-pulse' : undefined} />
      </div>
      <h2 className="text-[19px] font-semibold">{copy[0]}</h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">{copy[1]}</p>
      {hasHosts ? (
        // 목록이 있으면 다시 연결·전환·추가는 목록에서 한다
        <div className="mt-6 flex w-full justify-center">
          <HostList />
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {status === 'offline' && (
            <button
              type="button"
              onClick={() => syncClient?.reconnect()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg"
            >
              <RefreshCw size={16} />
              다시 연결
            </button>
          )}
          {status !== 'connecting' && (
            <button
              type="button"
              onClick={() => actions().setOverlay('settings')}
              className={
                status === 'offline'
                  ? 'inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2'
                  : 'inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg'
              }
            >
              <Link2 size={16} />
              {status === 'unpaired' ? 'PC와 페어링' : '연결 설정'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
