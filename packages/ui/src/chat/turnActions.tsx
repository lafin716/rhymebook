import { childrenOf, defaultSkills, listedRootSessions, REORGANIZE_SKILL_ID, skillRef, turnMessageIds, turnMoveTargets, type ID, type Message, type Session } from '@branch/core';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { actions, appStore, useApp } from '../app/store';
import { pushNotice } from '../app/sync';
import { confirm } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { useSkills } from '../skills/skillsStore';

/** 분리·옮기기 공통 확인: 첫 질문·답변 중이면 이유를 알리고 false */
function turnMovable(sessionId: ID, questionId: ID, verb: string): boolean {
  const st = appStore.getState();
  if (!turnMessageIds(st.messages[sessionId] ?? [], questionId)) {
    pushNotice(`첫 질문은 ${verb} 수 없어요.`);
    return false;
  }
  if (st.streaming[sessionId]) {
    pushNotice(`답변이 끝난 뒤 ${verb} 수 있어요.`);
    return false;
  }
  return true;
}

/** 질문(과 답변)을 같은 레벨의 별도 세션으로 분리한다. 제목은 AI가 다시 짓는다 (ADR-066) */
export function splitTurnSibling(sessionId: ID, questionId: ID) {
  if (!turnMovable(sessionId, questionId, '분리할')) return;
  const id = actions().splitTurn(sessionId, questionId, undefined, { sibling: true });
  if (!id) pushNotice('질문을 분리하지 못했어요.');
  else pushNotice('별도 세션으로 분리했어요. 제목은 AI가 지어요.');
}

const useMovePick = create<{ pick: { sessionId: ID; questionId: ID } | null }>(() => ({ pick: null }));

/** 질문을 옮길 세션을 고르는 창을 연다 (ADR-067) */
export function pickMoveTarget(sessionId: ID, questionId: ID) {
  if (!turnMovable(sessionId, questionId, '옮길')) return;
  const st = appStore.getState();
  if (!turnMoveTargets(st.sessions, st.messages[sessionId] ?? [], sessionId, questionId).length) {
    pushNotice('옮길 수 있는 다른 세션이 없어요.');
    return;
  }
  useMovePick.setState({ pick: { sessionId, questionId } });
}

interface Row {
  session: Session;
  depth: number;
}

/** 학습(루트) 순서 → 트리 DFS 순서로 펼친다 */
function treeRows(sessions: Record<ID, Session>, messages: Record<ID, Message[]>): Row[] {
  const out: Row[] = [];
  const walk = (s: Session, depth: number) => {
    out.push({ session: s, depth });
    for (const c of childrenOf(sessions, s.id)) walk(c, depth + 1);
  };
  for (const r of listedRootSessions(sessions, messages)) walk(r, 0);
  return out;
}

/** 질문 옮기기 대상 선택 창. App·세션 창에 한 번 마운트한다 */
export function MoveTurnHost() {
  const pick = useMovePick((s) => s.pick);
  const close = () => useMovePick.setState({ pick: null });
  return (
    <Modal open={!!pick} onClose={close} label="질문 옮기기" size="tall" className="md:max-w-md">
      {pick && <MoveTurnPicker sessionId={pick.sessionId} questionId={pick.questionId} onClose={close} />}
    </Modal>
  );
}

function MoveTurnPicker({ sessionId, questionId, onClose }: { sessionId: ID; questionId: ID; onClose(): void }) {
  const sessions = useApp((s) => s.sessions);
  const messages = useApp((s) => s.messages);
  const list = messages[sessionId];
  const [q, setQ] = useState('');
  const targets = useMemo(() => new Set(turnMoveTargets(sessions, list ?? [], sessionId, questionId)), [sessions, list, sessionId, questionId]);
  const rows = useMemo(() => {
    const all = treeRows(sessions, messages);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => r.session.title.toLowerCase().includes(needle)).map((r) => ({ ...r, depth: 0 })) : all;
  }, [sessions, messages, q]);
  const question = list?.find((m) => m.id === questionId)?.content.replace(/\s+/g, ' ').trim() ?? '';

  const move = (targetId: ID) => {
    onClose();
    const title = appStore.getState().sessions[targetId]?.title ?? '';
    if (actions().moveTurn(sessionId, questionId, targetId)) pushNotice(`“${title}” 세션 끝으로 옮겼어요.`);
    else pushNotice('질문을 옮기지 못했어요.');
  };

  return (
    <>
      <div className="shrink-0 border-b border-line px-4 pt-4 pb-3">
        <h2 className="text-[16px] font-semibold text-fg">다른 세션으로 옮기기</h2>
        {question && <p className="mt-1 truncate text-[13px] text-muted">“{question}”</p>}
        <label className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-[14px]">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="세션 제목 검색"
            aria-label="세션 제목 검색"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <ul role="listbox" aria-label="옮길 세션" className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.map(({ session: s, depth }) => {
          const ok = targets.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={!ok}
                data-move-target={s.id}
                onClick={() => move(s.id)}
                style={{ paddingLeft: 10 + depth * 16 }}
                className={cn(
                  'flex min-h-10 w-full items-center gap-2 rounded-md py-2 pr-2.5 text-left text-[14px] max-md:min-h-11',
                  ok ? 'text-fg hover:bg-surface-2' : 'cursor-not-allowed text-muted',
                  depth === 0 && 'font-medium',
                )}
              >
                {depth > 0 && <span className="text-line-strong">└</span>}
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {s.id === sessionId && <span className="shrink-0 text-[11.5px] text-muted">현재 세션</span>}
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="px-3 py-6 text-center text-[13px] text-muted">찾는 세션이 없어요.</li>}
      </ul>
      <div className="shrink-0 border-t border-line px-4 py-3 text-right">
        <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-[14px] text-fg-2 hover:bg-surface-2">
          취소
        </button>
      </div>
    </>
  );
}

/** 세션 전체를 하나의 질문·답변으로 재정리한다. 하위 세션은 각주가 된다 (ADR-068) */
export async function reorganizeSession(sessionId: ID) {
  const st = appStore.getState();
  const list = st.messages[sessionId] ?? [];
  if (st.streaming[sessionId]) {
    pushNotice('답변이 끝난 뒤 재정리할 수 있어요.');
    return;
  }
  if (!list.some((m) => m.role === 'assistant' && m.content.trim())) {
    pushNotice('정리할 답변이 아직 없어요.');
    return;
  }
  const questions = list.filter((m) => m.role === 'user').length;
  const branches = Object.values(st.sessions).filter((s) => s.parentId === sessionId).length;
  const ok = await confirm({
    title: '이 세션을 재정리할까요?',
    message: (
      <>
        질문 {questions}개와 답변을 하나의 질문과 답변으로 정리해 바꿔요.
        {branches > 0 && ` 하위 세션 ${branches}개는 각주로 남아요.`} 본문 메모·하이라이트는 사라지며, 실패하면 원래 대화를 그대로 둬요.
      </>
    ),
    confirmLabel: '재정리',
  });
  if (!ok) return;
  const skills = useSkills.getState().skills;
  const skill = skills.find((k) => k.id === REORGANIZE_SKILL_ID) ?? skills.find((k) => k.name === 'reorganize') ?? defaultSkills().find((k) => k.id === REORGANIZE_SKILL_ID);
  const firstId = list[0]!.id;
  if (!actions().reorganizeSession(sessionId, skill ? skillRef(skill) : undefined)) {
    pushNotice('재정리를 시작하지 못했어요.');
    return;
  }
  // 끝난 뒤에도 원래 첫 메시지가 남아 있으면 실패(원본 유지)
  const failedNow = (s: ReturnType<typeof appStore.getState>) => !!s.sessions[sessionId] && !!s.messages[sessionId]?.some((m) => m.id === firstId);
  let started = !!appStore.getState().streaming[sessionId];
  let unsub = () => {};
  const stop = () => {
    unsub();
    clearTimeout(timer);
  };
  // 시작조차 못 하면(원격 PC가 거부 등) 구독을 오래 붙잡지 않는다
  const timer = setTimeout(() => {
    if (started) return;
    stop();
    if (failedNow(appStore.getState())) pushNotice('재정리하지 못했어요. 원래 대화는 그대로예요.');
  }, 15_000);
  unsub = appStore.subscribe((s) => {
    if (!s.sessions[sessionId]) return stop();
    if (s.streaming[sessionId]) {
      started = true;
      return;
    }
    if (!started) return;
    stop();
    if (failedNow(s)) pushNotice('재정리하지 못했어요. 원래 대화는 그대로예요.');
  });
}
