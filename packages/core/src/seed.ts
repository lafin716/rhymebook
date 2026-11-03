import { t } from './i18n';
import type { Anchor, ConnectionState, ID, Message, ProviderId, Session, Settings, ViewState } from './model';
import type { MessageMap } from './context';
import type { SessionMap } from './tree';

/** content 안에서 literal의 n번째(0부터) 출현 위치로 앵커를 만든다 */
export function anchorFor(message: Message, literal: string, nth = 0): Anchor {
  let idx = -1;
  for (let k = 0; k <= nth; k++) {
    idx = message.content.indexOf(literal, idx + 1);
    if (idx < 0) throw new Error(`seed anchor not found: ${literal}`);
  }
  return { messageId: message.id, text: literal, startOffset: idx, endOffset: idx + literal.length };
}

/* 데모 시드 본문은 호출 시점의 로케일로 만든다 (모듈 로드 시점에 고정하지 않음) */
export const rootAnswer = (): string => t('seed.answer.root');
const rootAnswer2 = (): string => t('seed.answer.root2');
const rootAnswer3 = (): string => t('seed.answer.root3');
const rootAnswer4 = (): string => t('seed.answer.root4');
const qkvAnswer = (): string => t('seed.answer.qkv');
const dotAnswer = (): string => t('seed.answer.dot');
export const cosAnswer = (): string => t('seed.answer.cos');
const softmaxAnswer = (): string => t('seed.answer.softmax');
const scaleAnswer = (): string => t('seed.answer.scale');
const backpropAnswer = (): string => t('seed.answer.backprop');

export const SEED_IDS = {
  root: 's-root',
  qkv: 's-qkv',
  dot: 's-dot',
  cos: 's-cos',
  softmax: 's-softmax',
  scale: 's-scale',
  backprop: 's-backprop',
} as const;

export interface SeedData {
  sessions: SessionMap;
  messages: MessageMap;
}

export function createSeed(now = Date.now()): SeedData {
  const sessions: SessionMap = {};
  const messages: MessageMap = {};
  let clock = now - 1000 * 60 * 60 * 26;
  const tick = (min = 2) => (clock += 1000 * 60 * min);

  const session = (s: Omit<Session, 'createdAt' | 'updatedAt'>): Session => {
    const created = tick(1);
    const full: Session = { ...s, createdAt: created, updatedAt: created };
    sessions[full.id] = full;
    messages[full.id] = [];
    return full;
  };
  const msg = (sessionId: ID, role: Message['role'], content: string, providerId?: ProviderId): Message => {
    const m: Message = {
      id: `${sessionId}-m${messages[sessionId]!.length + 1}`,
      sessionId,
      role,
      content,
      createdAt: tick(1),
      status: 'done',
      ...(role === 'assistant' ? { providerId: providerId ?? 'mock' } : {}),
    };
    messages[sessionId]!.push(m);
    sessions[sessionId]!.updatedAt = m.createdAt;
    return m;
  };

  // 다른 루트 세션 (목록/검색용)
  const bp = session({ id: SEED_IDS.backprop, parentId: null, rootId: SEED_IDS.backprop, title: t('seed.session.backprop') });
  msg(bp.id, 'user', t('seed.question.backprop'));
  msg(bp.id, 'assistant', backpropAnswer());
  tick(60 * 20);

  // 루트: 트랜스포머 어텐션
  const root = session({ id: SEED_IDS.root, parentId: null, rootId: SEED_IDS.root, title: t('seed.session.root') });
  msg(root.id, 'user', t('seed.question.root'));
  const ra1 = msg(root.id, 'assistant', rootAnswer());
  msg(root.id, 'user', t('seed.question.root2'));
  msg(root.id, 'assistant', rootAnswer2());
  msg(root.id, 'user', t('seed.question.root3'));
  msg(root.id, 'assistant', rootAnswer3());
  msg(root.id, 'user', t('seed.question.root4'));
  msg(root.id, 'assistant', rootAnswer4());

  // 깊이 1: Query, Key, Value
  const qkvAnchor = anchorFor(ra1, t('seed.anchor.qkv'));
  const qkv = session({ id: SEED_IDS.qkv, parentId: root.id, rootId: root.id, title: t('seed.session.qkv'), anchor: qkvAnchor });
  msg(qkv.id, 'user', t('seed.question.qkv'));
  const qa1 = msg(qkv.id, 'assistant', qkvAnswer());

  // 깊이 2: 내적 (요약 있음)
  const dot = session({
    id: SEED_IDS.dot,
    parentId: qkv.id,
    rootId: root.id,
    title: t('seed.session.dot'),
    anchor: anchorFor(qa1, t('seed.anchor.dot')),
    summary: t('seed.summary.dot'),
  });
  msg(dot.id, 'user', t('seed.question.dot'));
  const da1 = msg(dot.id, 'assistant', dotAnswer());

  // 깊이 3: 코사인 유사도
  const cos = session({
    id: SEED_IDS.cos,
    parentId: dot.id,
    rootId: root.id,
    title: t('seed.session.cos'),
    anchor: anchorFor(da1, t('seed.anchor.cos')),
  });
  msg(cos.id, 'user', t('seed.question.cos'));
  msg(cos.id, 'assistant', cosAnswer());

  // 깊이 1: 소프트맥스 (요약 있음)
  const sm = session({
    id: SEED_IDS.softmax,
    parentId: root.id,
    rootId: root.id,
    title: t('seed.session.softmax'),
    anchor: anchorFor(ra1, t('seed.anchor.softmax')),
    summary: t('seed.summary.softmax'),
  });
  msg(sm.id, 'user', t('seed.question.softmax'));
  msg(sm.id, 'assistant', softmaxAnswer());

  // 깊이 1: 스케일링 (요약 없음)
  const sc = session({
    id: SEED_IDS.scale,
    parentId: root.id,
    rootId: root.id,
    title: t('seed.session.scale'),
    anchor: anchorFor(ra1, t('seed.anchor.scale')),
  });
  msg(sc.id, 'user', t('seed.question.scale'));
  msg(sc.id, 'assistant', scaleAnswer());

  // 루트가 가장 최근 활동이 되도록
  sessions[root.id]!.updatedAt = clock;
  return { sessions, messages };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultProviderId: 'mock',
  fallbackOrder: ['anthropic-api', 'claude-cli', 'openai-api', 'codex-cli', 'remote-bridge', 'mock'],
  contextWindow: 6,
  anchorOpenTarget: 'popup',
};

/** 실제 실행의 기본 설정: 공개 배포 기본 연결은 API 키(정책) */
export const RUNTIME_SETTINGS: Settings = { ...DEFAULT_SETTINGS, defaultProviderId: 'anthropic-api' };

/** 실제 실행의 초기 연결 상태. 상태 값은 시작 시 refreshConnections()로 채운다 */
export function initialConnections(): Record<ProviderId, ConnectionState> {
  return {
    mock: { providerId: 'mock', status: 'ready', enabled: true, detail: t('seed.connection.mock') },
    'claude-cli': { providerId: 'claude-cli', status: 'checking', enabled: true },
    'codex-cli': { providerId: 'codex-cli', status: 'checking', enabled: true },
    'anthropic-api': { providerId: 'anthropic-api', status: 'checking', enabled: true },
    'openai-api': { providerId: 'openai-api', status: 'checking', enabled: true },
    'remote-bridge': { providerId: 'remote-bridge', status: 'checking', enabled: true },
  };
}

/** 프로토타입 목업 연결 상태 */
export function defaultConnections(): Record<ProviderId, ConnectionState> {
  return {
    mock: { providerId: 'mock', status: 'ready', enabled: true, detail: t('seed.connection.mock') },
    'claude-cli': { providerId: 'claude-cli', status: 'ready', enabled: true, detail: t('seed.connection.claudeCli') },
    'codex-cli': { providerId: 'codex-cli', status: 'not-logged-in', enabled: false, detail: 'codex 0.48.0' },
    'anthropic-api': { providerId: 'anthropic-api', status: 'ready', enabled: true, detail: 'sk-ant-…7Q2c' },
    'openai-api': { providerId: 'openai-api', status: 'no-key', enabled: false },
    'remote-bridge': { providerId: 'remote-bridge', status: 'unpaired', enabled: false },
  };
}

export function emptyView(activeSessionId: ID | null = null): ViewState {
  return {
    mode: 'single',
    activeSessionId,
    splitSessionIds: [],
    focusedSplitIndex: 0,
    popups: [],
    sheetSessionIds: [],
  };
}
