import { t, tx } from '../i18n';
import { OctoGarden } from '../components/OctoMark';
import { listedRootSessions, type ID } from '@branch/core';
import { FileText, Laptop, Link2, List, PenLine, RefreshCw, Smartphone, Sparkles } from 'lucide-react';
import { remoteMode } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { sessionWindowId } from '../app/runtime';
import { chooseThisDevice, syncClient, useRemoteHosts, useSync } from '../app/sync';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { HostList, thisDeviceName } from '../components/HostList';
import { usePcOnline } from '../components/PcStatus';
import { startNewSession } from '../session/newSession';

const SUGGESTION_KEYS = ['chat.empty.suggest1', 'chat.empty.suggest2', 'chat.empty.suggest3'] as const;

/** 메시지가 없는 세션의 첫 화면 */
export function EmptyChat({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const online = usePcOnline();
  // 새로 만들기로 연 빈 대화는 아직 목록에 없다. 대화 대신 빈 페이지로 시작할 수도 있다 (ADR-074)
  const root = useApp((s) => s.sessions[sessionId]?.parentId === null);
  return (
    <div className="octo-welcome mx-auto flex max-w-xl flex-col items-center rounded-3xl px-4 py-8 text-center sm:py-12">
      <OctoGarden />
      <span className="mb-3 text-[10px] font-semibold tracking-[.22em] text-accent">A LITTLE QUESTION. A NEW DIRECTION.</span>
      <h2 className="text-[18px] font-semibold">{t('chat.empty.welcomeTitle')}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
        {tx('chat.empty.hint', { drag: <b className="font-medium text-fg-2">{t('chat.empty.dragWord')}</b> })}
        <br className={compact ? 'hidden' : undefined} />{t('chat.empty.hintContinue')}
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {SUGGESTION_KEYS.map((k) => {
          const q = t(k);
          return (
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
          );
        })}
      </div>
      {root && (
        <p className="mt-4 flex flex-wrap items-center justify-center gap-1 text-[13px] text-muted">
          {t('chat.empty.orOwn')}
          <button
            type="button"
            disabled={!online}
            onClick={() => actions().newPage()}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
          >
            <FileText size={14} />
            {t('chat.empty.startBlank')}
          </button>
          {t('chat.empty.or')}
          <button
            type="button"
            disabled={!online}
            onClick={() => actions().newPage(undefined, { kind: 'canvas' })}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
          >
            <PenLine size={14} />
            {t('chat.empty.startCanvas')}
          </button>
        </p>
      )}
    </div>
  );
}

/** 세션이 하나도 없을 때. 원격 모드는 PC와 연결된 뒤에만 시작할 수 있다 */
export function NoSessions() {
  const online = usePcOnline();
  const hasSessions = useApp((s) => listedRootSessions(s.sessions, s.messages).length > 0);
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
      <p className="mb-3 text-[11px] font-semibold tracking-[.22em] text-accent">{t('chat.empty.tagline')}</p>
      <h2 className="text-[19px] font-semibold">
        {hasSessions ? t('chat.empty.pickUp') : remoteMode ? t('chat.empty.noRemoteHistory') : t('chat.empty.startLocal')}
      </h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">
        {hasSessions
          ? t('chat.empty.sessionsHint')
          : remoteMode
            ? t('chat.empty.remoteHint')
            : t('chat.empty.localHint')}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {hasSessions && (
          <button
            type="button"
            onClick={openList}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg"
          >
            <List size={16} />
            {t('chat.empty.openList')}
          </button>
        )}
        <button
          type="button"
          onClick={startNewSession}
          className={
            hasSessions
              ? 'inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2'
              : 'inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg'
          }
        >
          {t('chat.empty.newLearning')}
        </button>
        <button
          type="button"
          onClick={() => actions().newPage()}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2"
        >
          <FileText size={16} />
          {t('chat.empty.blankPage')}
        </button>
        <button
          type="button"
          onClick={() => actions().newPage(undefined, { kind: 'canvas' })}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2"
        >
          <PenLine size={16} />
          {t('chat.empty.canvas')}
        </button>
      </div>
      <Profiles />
    </div>
  );
}

/** 메인 화면 프로필 목록: 이 기기 · 저장한 PC로 전환한다 (ADR-063·103) */
function Profiles() {
  const count = useRemoteHosts((s) => s.hosts.length);
  if (remoteMode && !count) return null;
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
      ? [t('chat.empty.pickPcTitle'), t('chat.empty.pickPcBody')]
      : [t('chat.empty.pairPcTitle'), t('chat.empty.pairPcBody')],
    connecting: [t('chat.empty.connectingTitle', { pc }), t('chat.empty.connectingBody')],
    offline: [t('chat.empty.offlineTitle', { pc }), t('chat.empty.offlineBody')],
    unsupported: [t('chat.empty.unsupportedTitle'), t('chat.empty.unsupportedBody')],
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
              {t('chat.empty.reconnect')}
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
              {status === 'unpaired' ? t('chat.empty.pairPc') : t('chat.empty.connectSettings')}
            </button>
          )}
          {/* PC 없이도 이 기기에서 학습하고 API 키로 답변받을 수 있다 (ADR-103) */}
          {status !== 'connecting' && !sessionWindowId && (
            <button
              type="button"
              onClick={chooseThisDevice}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2"
            >
              <Smartphone size={16} />
              {t('chat.empty.useThisDevice', { device: thisDeviceName() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
