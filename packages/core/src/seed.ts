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

export const ROOT_ANSWER = `**어텐션(Attention)** 은 문장의 각 단어가 "다른 어떤 단어를 얼마나 참고할지"를 스스로 정하는 메커니즘이에요.

핵심 식은 다음과 같습니다.

\`\`\`text
Attention(Q, K, V) = softmax(Q·Kᵀ / √d_k) · V
\`\`\`

1. 각 단어를 **Query, Key, Value** 세 벡터로 바꿉니다.
2. Query와 모든 Key를 비교해 관련도 점수를 구합니다.
3. 점수를 **스케일링(√d_k)** 한 뒤 **소프트맥스**로 가중치로 만듭니다.
4. 가중치로 Value를 가중합해 새 표현을 얻습니다.

예를 들어 "고양이가 매트 위에 앉았다, **그것은** 따뜻했다"에서 *그것은*은 *매트*에 높은 가중치를 줍니다.`;

const ROOT_ANSWER_2 = `**멀티헤드 어텐션**은 위의 어텐션을 여러 개(헤드) 병렬로 돌리는 방법이에요.

- 각 헤드는 서로 다른 \`W_Q, W_K, W_V\`를 가져 **다른 관점**의 관계를 학습합니다.
- 예: 한 헤드는 문법 관계, 다른 헤드는 지시 대상(그것 → 매트)에 집중합니다.
- 결과를 이어붙인 뒤(concat) 선형 변환으로 합칩니다.

> 비유: 한 문장을 문법 선생님, 국어 선생님, 역사 선생님이 동시에 읽고 메모를 합치는 것.`;

const ROOT_ANSWER_3 = `트랜스포머에는 어텐션이 **세 군데**에서 쓰여요.

1. **인코더 셀프 어텐션**: 입력 문장의 단어끼리 서로를 참고
2. **디코더 마스크드 셀프 어텐션**: 지금까지 생성한 단어만 참고 (미래 단어는 가림)
3. **인코더–디코더(크로스) 어텐션**: 디코더의 Query가 인코더 출력의 Key/Value를 참고

> 비유: 번역가가 원문을 훑어보고(1), 지금까지 쓴 번역문을 다시 읽고(2), 다음 단어를 쓸 때 원문의 해당 부분을 찾아보는(3) 과정.`;

const ROOT_ANSWER_4 = `문장 길이를 **n**이라 하면 어텐션의 계산량은 **O(n²)** 이에요.

- 모든 단어 쌍(n × n)의 점수를 구해야 하기 때문
- 그래서 긴 문서에서는 메모리와 시간이 빠르게 늘어남

이를 줄이려고 **희소 어텐션**, **슬라이딩 윈도우**, **FlashAttention** 같은 기법이 쓰입니다.`;

const QKV_ANSWER = `**Query / Key / Value** 는 도서관 검색에 비유하면 쉬워요.

- **Query(질의)**: 내가 찾고 싶은 것 — "따뜻한 물건에 관한 책"
- **Key(색인)**: 각 책의 라벨 — 검색어와 비교되는 대상
- **Value(내용)**: 실제로 가져올 책의 내용

어텐션은 Query와 모든 Key의 **내적**으로 "얼마나 관련 있는지" 점수를 매기고, 그 점수로 Value들을 섞어 결과를 만듭니다.
세 벡터는 같은 단어 임베딩에 서로 다른 가중치 행렬 \`W_Q\`, \`W_K\`, \`W_V\`를 곱해서 얻어요.`;

const DOT_ANSWER = `**내적(dot product)** 은 두 벡터의 같은 위치 값끼리 곱해서 모두 더한 값이에요.

\`\`\`python
q = [1, 2, 0]
k = [2, 1, 3]
score = sum(a * b for a, b in zip(q, k))  # 1*2 + 2*1 + 0*3 = 4
\`\`\`

두 벡터가 **비슷한 방향**일수록 값이 커져요. 그래서 어텐션에서는 "Query와 Key가 얼마나 잘 맞는가"를 재는 점수로 씁니다.
길이까지 정규화하면 코사인 유사도가 됩니다.`;

const COS_ANSWER = `**코사인 유사도**는 두 벡터가 **같은 방향을 가리키는 정도**만 보는 척도예요.

- 공식: \`cos θ = (a · b) / (|a| |b|)\`
- 값 범위: **-1**(정반대) ~ **1**(같은 방향)

> 비유: 두 사람이 손가락으로 가리키는 *방향*만 비교하고, 팔 길이는 무시하는 것.

어텐션의 내적은 길이로 나누지 않은 "날것의 코사인 유사도"라고 보면 됩니다.`;

const SOFTMAX_ANSWER = `**소프트맥스(softmax)** 는 점수 목록을 **합이 1인 확률 분포**로 바꾸는 함수예요.

| 점수 | e^점수 | 비율 |
|---|---|---|
| 2.0 | 7.39 | 0.66 |
| 1.0 | 2.72 | 0.24 |
| 0.1 | 1.11 | 0.10 |

> 비유: 투표 결과를 "득표율"로 바꾸되, 1등을 조금 더 밀어주는 방식.

어텐션에서는 각 단어에 **얼마나 주목할지(가중치)** 를 정하는 데 사용됩니다.`;

const SCALE_ANSWER = `**√d_k로 나누는 이유**는 내적 값이 차원이 커질수록 너무 커지기 때문이에요.

1. 차원 d_k가 크면 내적의 분산도 d_k에 비례해 커짐
2. 큰 값이 소프트맥스에 들어가면 한 항목만 1에 가깝고 나머지는 0 → **기울기 소실**
3. √d_k로 나눠 분산을 1 근처로 맞춰 줌

> 비유: 시험 점수가 1000점 만점이면 등수 차이가 너무 극단적으로 보이니, 100점 만점으로 환산하는 것.`;

const BACKPROP_ANSWER = `**역전파(backpropagation)** 는 출력의 오차를 거꾸로 전달하며 각 가중치가 오차에 얼마나 기여했는지(기울기)를 계산하는 방법이에요.

1. 순전파로 예측값과 손실을 계산
2. 연쇄 법칙(chain rule)으로 출력층부터 입력층 방향으로 기울기를 계산
3. 경사 하강법으로 가중치를 갱신`;

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
  let t = now - 1000 * 60 * 60 * 26;
  const tick = (min = 2) => (t += 1000 * 60 * min);

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
  const bp = session({ id: SEED_IDS.backprop, parentId: null, rootId: SEED_IDS.backprop, title: '역전파 기초' });
  msg(bp.id, 'user', '역전파가 어떻게 동작하는지 간단히 알려줘');
  msg(bp.id, 'assistant', BACKPROP_ANSWER);
  tick(60 * 20);

  // 루트: 트랜스포머 어텐션
  const root = session({ id: SEED_IDS.root, parentId: null, rootId: SEED_IDS.root, title: '트랜스포머 어텐션' });
  msg(root.id, 'user', '트랜스포머의 어텐션이 뭔지 설명해줘');
  const ra1 = msg(root.id, 'assistant', ROOT_ANSWER);
  msg(root.id, 'user', '그럼 멀티헤드 어텐션은 뭐가 달라?');
  msg(root.id, 'assistant', ROOT_ANSWER_2);
  msg(root.id, 'user', '인코더랑 디코더에서 어텐션이 다르게 쓰여?');
  msg(root.id, 'assistant', ROOT_ANSWER_3);
  msg(root.id, 'user', '어텐션 계산량은 얼마나 돼? 긴 문장에서도 괜찮아?');
  msg(root.id, 'assistant', ROOT_ANSWER_4);

  // 깊이 1: Query, Key, Value
  const qkvAnchor = anchorFor(ra1, 'Query, Key, Value');
  const qkv = session({ id: SEED_IDS.qkv, parentId: root.id, rootId: root.id, title: 'Query, Key, Value', anchor: qkvAnchor });
  msg(qkv.id, 'user', '"Query, Key, Value"이(가) 뭐야?');
  const qa1 = msg(qkv.id, 'assistant', QKV_ANSWER);

  // 깊이 2: 내적 (요약 있음)
  const dot = session({
    id: SEED_IDS.dot,
    parentId: qkv.id,
    rootId: root.id,
    title: '내적',
    anchor: anchorFor(qa1, '내적'),
    summary: '내적은 같은 위치끼리 곱해 더한 값으로, 두 벡터가 비슷한 방향일수록 커져서 Query–Key 관련도 점수로 쓰인다.',
  });
  msg(dot.id, 'user', '"내적"이(가) 뭐야?');
  const da1 = msg(dot.id, 'assistant', DOT_ANSWER);

  // 깊이 3: 코사인 유사도
  const cos = session({
    id: SEED_IDS.cos,
    parentId: dot.id,
    rootId: root.id,
    title: '코사인 유사도',
    anchor: anchorFor(da1, '코사인 유사도'),
  });
  msg(cos.id, 'user', '"코사인 유사도"에 대해 더 자세히 설명해줘.');
  msg(cos.id, 'assistant', COS_ANSWER);

  // 깊이 1: 소프트맥스 (요약 있음)
  const sm = session({
    id: SEED_IDS.softmax,
    parentId: root.id,
    rootId: root.id,
    title: '소프트맥스',
    anchor: anchorFor(ra1, '소프트맥스'),
    summary: '소프트맥스는 점수 목록을 합이 1인 확률로 바꿔, 각 단어에 얼마나 주목할지 정하는 가중치를 만든다.',
  });
  msg(sm.id, 'user', '"소프트맥스"이(가) 뭐야?');
  msg(sm.id, 'assistant', SOFTMAX_ANSWER);

  // 깊이 1: 스케일링 (요약 없음)
  const sc = session({
    id: SEED_IDS.scale,
    parentId: root.id,
    rootId: root.id,
    title: '스케일링(√d_k)',
    anchor: anchorFor(ra1, '스케일링(√d_k)'),
  });
  msg(sc.id, 'user', '"스케일링(√d_k)"에 대해 더 자세히 설명해줘.');
  msg(sc.id, 'assistant', SCALE_ANSWER);

  // 루트가 가장 최근 활동이 되도록
  sessions[root.id]!.updatedAt = t;
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
    mock: { providerId: 'mock', status: 'ready', enabled: true, detail: '데모 응답' },
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
    mock: { providerId: 'mock', status: 'ready', enabled: true, detail: '데모 응답' },
    'claude-cli': { providerId: 'claude-cli', status: 'ready', enabled: true, detail: 'claude 2.1.4 · 로그인됨' },
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
