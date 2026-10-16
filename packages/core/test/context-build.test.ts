import { describe, expect, it } from 'vitest';
import {
  BASE_SYSTEM,
  BRANCH_INSTRUCTION,
  SUBSESSION_INSTRUCTION,
  buildChatRequest,
  buildSummaryRequest,
  buildSystemPrompt,
  buildTitleRequest,
  cleanTitle,
  toTurns,
  type MessageMap,
} from '../src/context';
import type { Message, Session } from '../src/model';
import type { SessionMap } from '../src/tree';

let t = 0;
const msg = (id: string, sessionId: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({
  id,
  sessionId,
  role,
  content,
  createdAt: t++,
  ...extra,
});

const sess = (s: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  ...s,
  parentId: s.parentId ?? null,
  rootId: s.rootId ?? s.id,
  createdAt: s.createdAt ?? t++,
  updatedAt: s.updatedAt ?? t,
});

/** 루트(4턴) → A(앵커: 2번째 답) → B(앵커: A의 답) 3단계 트리 */
function fixture() {
  const root = sess({ id: 'r', title: '선형대수' });
  const rootMsgs = [
    msg('r1', 'r', 'user', '행렬 곱이 뭐야?'),
    msg('r2', 'r', 'assistant', '행렬 곱은 행과 열의 내적을 모은 것입니다.'),
    msg('r3', 'r', 'user', '고유값은?'),
    msg('r4', 'r', 'assistant', '고유값은 선형 변환이 방향을 유지하는 벡터의 배율입니다.'),
    msg('r5', 'r', 'user', '앵커 이후의 질문 — 맥락에 들어가면 안 됨'),
  ];
  const a = sess({
    id: 'a',
    title: '고유값',
    parentId: 'r',
    rootId: 'r',
    anchor: { messageId: 'r4', text: '고유값', startOffset: 0, endOffset: 3 },
  });
  const a2 = '배율 λ를 고유값, 그 벡터를 고유벡터라 합니다.';
  const aMsgs = [msg('a1', 'a', 'user', '"고유값"이(가) 뭐야?'), msg('a2', 'a', 'assistant', a2)];
  const b = sess({
    id: 'b',
    title: '고유벡터',
    parentId: 'a',
    rootId: 'r',
    anchor: { messageId: 'a2', text: '고유벡터', startOffset: a2.indexOf('고유벡터'), endOffset: a2.indexOf('고유벡터') + 4 },
  });
  const sessions: SessionMap = { r: root, a, b };
  const messages: MessageMap = { r: rootMsgs, a: aMsgs, b: [msg('b1', 'b', 'user', '"고유벡터"이(가) 뭐야?')] };
  return { sessions, messages };
}

describe('맥락 구성 — 서브세션 system 프롬프트', () => {
  it('조상 앵커 체인을 루트 → 현재 순서로, 원문 문맥과 함께 넣는다', () => {
    const { sessions, messages } = fixture();
    const sys = buildSystemPrompt({ sessions, messages, sessionId: 'b' });
    expect(sys.startsWith(BASE_SYSTEM)).toBe(true);
    expect(sys).toContain('루트 주제: 선형대수');
    const i1 = sys.indexOf('1. "고유값" — 문맥: "[고유값]은 선형 변환');
    const i2 = sys.indexOf('2. "고유벡터" — 문맥: "배율 λ를 고유값, 그 벡터를 [고유벡터]라 합니다."');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(sys).toContain(`## 지시\n${BRANCH_INSTRUCTION}\n현재 질문 대상: "고유벡터"`);
  });

  it('직접 만든 하위 세션은 생성 시점까지의 부모 대화와 하위 질문 지시를 쓴다', () => {
    const { sessions, messages } = fixture();
    const created = messages.r![3]!.createdAt + 0.5; // r4 이후, r5 이전
    const f = sess({ id: 'f', title: '응용', parentId: 'r', rootId: 'r', createdAt: created });
    const sys = buildSystemPrompt({ sessions: { ...sessions, f }, messages, sessionId: 'f' });
    expect(sys).toContain('(직접 만든 하위 세션) "응용"');
    expect(sys).toContain('고유값은 선형 변환이');
    expect(sys).not.toContain('앵커 이후의 질문');
    expect(sys).toContain(`## 지시\n${SUBSESSION_INSTRUCTION}`);
    expect(sys).not.toContain('현재 질문 대상');
  });

  it('부모 대화는 앵커 메시지까지만, 최근 N개로 자른다', () => {
    const { sessions, messages } = fixture();
    const sys = buildSystemPrompt({ sessions, messages, sessionId: 'a', contextWindow: 3 });
    expect(sys).toContain('### 부모 대화 (앵커 메시지까지 최근 3개)');
    expect(sys).not.toContain('행렬 곱이 뭐야?');
    expect(sys).toContain('[튜터] 행렬 곱은 행과 열의 내적');
    expect(sys).toContain('[학습자] 고유값은?');
    expect(sys).not.toContain('앵커 이후의 질문');
    // 자식 세션의 부모 대화는 직계 부모(A)의 대화만
    const sysB = buildSystemPrompt({ sessions, messages, sessionId: 'b' });
    expect(sysB).toContain('[튜터] 배율 λ를');
    expect(sysB).not.toContain('[학습자] 고유값은?');
  });

  it('빈 메시지는 건너뛰고 긴 메시지는 잘라 넣는다', () => {
    const { sessions, messages } = fixture();
    messages.r!.splice(3, 0, msg('rx', 'r', 'assistant', '   '));
    messages.r![2] = { ...messages.r![2]!, content: '가'.repeat(2000) };
    const sys = buildSystemPrompt({ sessions, messages, sessionId: 'a', contextWindow: 10 });
    expect(sys).toContain('최근 4개');
    expect(sys).toContain(`[학습자] ${'가'.repeat(1500)}…(생략)`);
    expect(sys).not.toContain('가'.repeat(1501));
  });

  it('앵커 메시지가 지워진 경우: 문맥 없이 앵커 텍스트만, 부모 대화는 최근 N개', () => {
    const { sessions, messages } = fixture();
    messages.r = messages.r!.filter((m) => m.id !== 'r4');
    const sys = buildSystemPrompt({ sessions, messages, sessionId: 'a', contextWindow: 2 });
    expect(sys).toContain('1. "고유값"\n');
    expect(sys).toContain('[학습자] 앵커 이후의 질문');
  });

  it('부모가 없거나(루트) 없는 세션은 기본 프롬프트', () => {
    const { sessions, messages } = fixture();
    expect(buildSystemPrompt({ sessions, messages, sessionId: 'r' })).toBe(BASE_SYSTEM);
    expect(buildSystemPrompt({ sessions, messages, sessionId: 'nope' })).toBe(BASE_SYSTEM);
    const { anchor: _, ...noAnchor } = sessions.a!;
    expect(buildSystemPrompt({ sessions: { ...sessions, a: noAnchor }, messages, sessionId: 'a' })).toContain(SUBSESSION_INSTRUCTION);
  });
});

describe('맥락 구성 — 요청 턴', () => {
  it('스트리밍 중·오류·빈 메시지는 provider 턴에서 제외한다', () => {
    const turns = toTurns([
      msg('1', 's', 'user', '질문'),
      msg('2', 's', 'assistant', '부분 답', { status: 'streaming' }),
      msg('3', 's', 'assistant', '실패', { status: 'error' }),
      msg('4', 's', 'assistant', ' '),
      msg('5', 's', 'assistant', '완료된 답'),
    ]);
    expect(turns).toEqual([
      { role: 'user', content: '질문' },
      { role: 'assistant', content: '완료된 답' },
    ]);
  });

  it('채팅 요청은 system(맥락) + 현재 세션 턴만 담는다', () => {
    const { sessions, messages } = fixture();
    const req = buildChatRequest({ sessions, messages, sessionId: 'b' });
    expect(req.purpose).toBe('chat');
    expect(req.messages).toEqual([{ role: 'user', content: '"고유벡터"이(가) 뭐야?' }]);
    expect(req.system).toContain('현재 질문 대상: "고유벡터"');
  });

  it('요약 요청은 앵커 텍스트와 서브세션 대화 전체, 제목 요청은 첫 2턴', () => {
    const { sessions, messages } = fixture();
    const sum = buildSummaryRequest(sessions.a!, messages.a!);
    expect(sum.purpose).toBe('summary');
    expect(sum.messages[0]!.content).toMatch(/^질문 대상: "고유값"\n\n\[학습자\] .+\n\[튜터\] 배율 λ/);
    const title = buildTitleRequest(messages.r!);
    expect(title.messages[0]!.content.split('\n')).toHaveLength(2);
    expect(cleanTitle(' "고유값과  고유벡터." ')).toBe('고유값과 고유벡터');
  });
});
