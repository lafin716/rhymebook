import type { ProviderId } from '../model';
import {
  providerError,
  type Availability,
  type LLMProvider,
  type StreamEvent,
  type StreamRequest,
} from '../provider';

/** 데모/프로토타입에서 Mock 동작을 조정하는 컨트롤러 (모든 MockProvider 인스턴스가 공유) */
export interface MockControl {
  /** 다음 요청 1회를 오류로 실패시킨다 */
  failNext: boolean;
  /** 토큰 간격 배율 (1 = 보통, 3 = 느림) */
  speed: number;
  /** 첫 토큰 전 지연(ms) */
  firstTokenDelay: number;
}

export const mockControl: MockControl = { failNext: false, speed: 1, firstTokenDelay: 450 };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

interface Canned {
  keys: RegExp;
  answer: string;
}

const CANNED: Canned[] = [
  {
    keys: /코사인/,
    answer: `**코사인 유사도**는 두 벡터가 **같은 방향을 가리키는 정도**만 보는 척도예요.

- 공식: \`cos θ = (a · b) / (|a| |b|)\`
- 값 범위: **-1**(정반대) ~ **1**(같은 방향)

> 비유: 두 사람이 손가락으로 가리키는 *방향*만 비교하고, 팔 길이는 무시하는 것.

어텐션의 내적은 길이로 나누지 않은 "날것의 코사인 유사도"라고 보면 됩니다.`,
  },
  {
    keys: /내적|dot product/i,
    answer: `**내적(dot product)** 은 두 벡터의 같은 위치 값끼리 곱해서 모두 더한 값이에요.

\`\`\`python
q = [1, 2, 0]
k = [2, 1, 3]
score = sum(a * b for a, b in zip(q, k))  # 1*2 + 2*1 + 0*3 = 4
\`\`\`

두 벡터가 **비슷한 방향**일수록 값이 커져요. 그래서 어텐션에서는 "Query와 Key가 얼마나 잘 맞는가"를 재는 점수로 씁니다.
길이까지 정규화하면 코사인 유사도가 됩니다.`,
  },
  {
    keys: /소프트맥스|softmax/i,
    answer: `**소프트맥스(softmax)** 는 점수 목록을 **합이 1인 확률 분포**로 바꾸는 함수예요.

| 점수 | e^점수 | 비율 |
|---|---|---|
| 2.0 | 7.39 | 0.66 |
| 1.0 | 2.72 | 0.24 |
| 0.1 | 1.11 | 0.10 |

> 비유: 투표 결과를 "득표율"로 바꾸되, 1등을 조금 더 밀어주는 방식.

어텐션에서는 각 단어에 **얼마나 주목할지(가중치)** 를 정하는 데 사용됩니다.`,
  },
  {
    keys: /√|루트|스케일|scale/i,
    answer: `**√d_k로 나누는 이유**는 내적 값이 차원이 커질수록 너무 커지기 때문이에요.

1. 차원 d_k가 크면 내적의 분산도 d_k에 비례해 커짐
2. 큰 값이 소프트맥스에 들어가면 한 항목만 1에 가깝고 나머지는 0 → **기울기 소실**
3. √d_k로 나눠 분산을 1 근처로 맞춰 줌

> 비유: 시험 점수가 1000점 만점이면 등수 차이가 너무 극단적으로 보이니, 100점 만점으로 환산하는 것.`,
  },
  {
    keys: /Query|Key|Value|Q\/K\/V|QKV/i,
    answer: `**Query / Key / Value** 는 도서관 검색에 비유하면 쉬워요.

- **Query(질의)**: 내가 찾고 싶은 것 — "고양이에 관한 책"
- **Key(색인)**: 각 책의 라벨 — 검색어와 비교되는 대상
- **Value(내용)**: 실제로 가져올 책의 내용

어텐션은 Query와 모든 Key의 **내적**으로 "얼마나 관련 있는지" 점수를 매기고, 그 점수로 Value들을 섞어 결과를 만듭니다.
세 벡터는 같은 단어 임베딩에 서로 다른 가중치 행렬 \`W_Q\`, \`W_K\`, \`W_V\`를 곱해서 얻어요.`,
  },
  {
    keys: /멀티.?헤드|multi.?head/i,
    answer: `**멀티헤드 어텐션**은 어텐션을 여러 개(헤드) 병렬로 돌리는 방법이에요.

- 각 헤드는 서로 다른 \`W_Q, W_K, W_V\`를 가져 **다른 관점**의 관계를 학습
- 예: 한 헤드는 문법 관계, 다른 헤드는 지시 대상(그것 → 고양이)에 집중
- 결과를 이어붙인 뒤(concat) 선형 변환으로 합칩니다

> 비유: 한 문장을 문법 선생님, 국어 선생님, 역사 선생님이 동시에 읽고 메모를 합치는 것.`,
  },
  {
    keys: /어텐션|attention/i,
    answer: `**어텐션(Attention)** 은 문장의 각 단어가 "다른 어떤 단어를 얼마나 참고할지"를 스스로 정하는 메커니즘이에요.

핵심 식은 다음과 같습니다.

\`\`\`text
Attention(Q, K, V) = softmax(Q·Kᵀ / √d_k) · V
\`\`\`

1. 각 단어를 Query, Key, Value 세 벡터로 바꿉니다.
2. Query와 모든 Key의 내적으로 관련도 점수를 구합니다.
3. 점수를 √d_k로 나눈 뒤 소프트맥스로 가중치로 만듭니다.
4. 가중치로 Value를 가중합해 새 표현을 얻습니다.

예를 들어 "고양이가 매트 위에 앉았다, **그것은** 따뜻했다"에서 *그것은*은 *매트*에 높은 가중치를 줍니다.`,
  },
];

function lastUser(req: StreamRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

function focusOf(req: StreamRequest): string | null {
  const m = /현재 질문 대상: "([^"]+)"/.exec(req.system);
  return m?.[1] ?? null;
}

/** 요청 목적과 내용에 맞는 가짜 응답 텍스트 */
export function mockAnswer(req: StreamRequest): string {
  const user = lastUser(req);
  if (req.purpose === 'title') {
    if (/어텐션|attention/i.test(user)) return '트랜스포머 어텐션';
    const first = user.replace(/\[[^\]]+\]\s*/g, '').split(/\s+/).slice(0, 3).join(' ');
    return first || '새 학습';
  }
  if (req.purpose === 'skill') {
    const ask = /## 요청\n([\s\S]*)$/.exec(user)?.[1]?.trim() ?? '';
    const cur = /<prompt>\n([\s\S]*?)\n<\/prompt>/.exec(user)?.[1];
    const keep = (tag: string, fallback: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(user)?.[1] || fallback;
    return [
      `<name>${keep('name', 'quiz')}</name>`,
      `<title>${keep('title', '개념 퀴즈')}</title>`,
      `<description>${keep('description', '주제의 핵심 개념을 퀴즈로 점검해요.')}</description>`,
      '<prompt>',
      cur ? `${cur}\n- 추가 요청 반영: ${ask}` : `학습자가 준 주제로 퀴즈를 낸다.\n\n1. 핵심 개념 **3개**를 골라 문제를 하나씩 낸다.\n2. 요청: ${ask}`,
      '</prompt>',
      // 부수 파일을 요청하면 참고 파일을 하나 만든다 (IMP-12)
      ...(/파일|참고/.test(ask) ? ['<file path="references/rubric.md">', '# 채점 기준', '- 정답: 핵심 용어를 **굵게** 짚었는가', '</file>'] : []),
      `<note>${cur ? '요청한 내용을 지시에 더했어요.' : '퀴즈 스킬을 만들었어요.'}</note>`,
    ].join('\n');
  }
  if (req.purpose === 'summary') {
    const target = /질문 대상: "([^"]+)"/.exec(user)?.[1] ?? '이 개념';
    const hit = CANNED.find((c) => c.keys.test(target));
    const gist = hit ? hit.answer.split('\n')[0]!.replace(/[*`]/g, '') : `${target}의 핵심 의미와 쓰임`;
    return `${gist} 즉, 앞선 설명의 맥락에서 "${target}"을(를) 이렇게 이해하면 된다.`;
  }
  const focus = focusOf(req);
  const probe = `${user} ${focus ?? ''}`;
  const hit = CANNED.find((c) => c.keys.test(user)) ?? CANNED.find((c) => c.keys.test(probe));
  if (hit) return hit.answer;
  const target = focus ?? user.slice(0, 40);
  return `좋은 질문이에요. **${target}** 를 앞선 맥락에 맞춰 짧게 설명해 볼게요.

- **핵심**: ${target}은(는) 지금 다루는 개념을 이루는 한 부분이에요.
- **비유**: 레고 설명서의 한 단계처럼, 이것을 이해해야 다음 단계가 맞춰집니다.
- **예시**: 실제 계산 한 번을 손으로 따라가 보면 감이 옵니다.

> (데모 응답입니다. 실제 provider를 연결하면 맥락에 맞는 설명이 생성됩니다.)`;
}

function chunk(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const n = 2 + Math.floor(Math.random() * 5);
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

export interface MockProviderOptions {
  id?: ProviderId;
  label?: string;
  /** 현재 연결 상태를 돌려준다 (목업 상태값 연동) */
  availability?: () => Availability;
  /** 응답 생성기 교체 */
  respond?: (req: StreamRequest) => string;
}

export function createMockProvider(opts: MockProviderOptions = {}): LLMProvider {
  const availability = opts.availability ?? (() => ({ status: 'ready' as const }));
  const respond = opts.respond ?? mockAnswer;
  return {
    id: opts.id ?? 'mock',
    label: opts.label ?? '데모 (Mock)',
    async available() {
      return availability();
    },
    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      const signal = req.signal;
      const avail = availability();
      try {
        await sleep(avail.status === 'ready' ? mockControl.firstTokenDelay : 600, signal);
        if (avail.status !== 'ready') {
          yield {
            type: 'error',
            error: providerError(
              avail.status === 'offline' ? 'offline' : avail.status === 'no-key' ? 'auth' : 'cli',
              availabilityMessage(avail),
            ),
          };
          return;
        }
        const text = respond(req);
        const parts = chunk(text);
        const failAt = mockControl.failNext ? Math.floor(parts.length * 0.35) : -1;
        mockControl.failNext = false;
        for (let i = 0; i < parts.length; i++) {
          if (i === failAt) {
            yield { type: 'error', error: providerError('network', '응답 스트림이 중간에 끊겼습니다 (데모 오류).') };
            return;
          }
          yield { type: 'delta', text: parts[i]! };
          await sleep((14 + Math.random() * 22) * mockControl.speed, signal);
        }
        yield { type: 'done', stopReason: 'end_turn' };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          yield { type: 'error', error: providerError('aborted', '사용자가 중지했습니다.') };
          return;
        }
        throw e;
      }
    },
  };
}

export function availabilityMessage(a: Availability): string {
  switch (a.status) {
    case 'ready':
      return '연결됨';
    case 'offline':
      return 'provider에 연결할 수 없습니다 (오프라인).';
    case 'not-installed':
      return 'CLI가 설치되어 있지 않습니다.';
    case 'not-logged-in':
      return 'CLI에 로그인되어 있지 않습니다.';
    case 'no-key':
      return 'API 키가 설정되지 않았습니다.';
    case 'unpaired':
      return '원격 Bridge와 페어링되지 않았습니다.';
  }
}
