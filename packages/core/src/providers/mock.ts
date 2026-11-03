import { branchSuggestInstruction } from '../branch-suggest';
import { reorganizeRequest } from '../context';
import { t, type MessageKey } from '../i18n';
import type { ProviderId } from '../model';
import {
  providerError,
  wantsWebTools,
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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

interface Canned {
  keys: RegExp;
  answer: string;
}

const CANNED_IDS = ['roadmap', 'cosine', 'dot', 'softmax', 'scale', 'qkv', 'multihead', 'attention'] as const;

/** 데모 답변 목록. 매칭 키워드(match/flags)와 답변은 로케일별 demo.canned.* 에서 읽는다 */
function cannedReplies(): Canned[] {
  return CANNED_IDS.map((id) => {
    const base = `demo.canned.${id}`;
    return {
      keys: new RegExp(t(`${base}.match` as MessageKey), t(`${base}.flags` as MessageKey)),
      answer: t(`${base}.answer` as MessageKey),
    };
  });
}

/**
 * 로케일 문구 템플릿을 정규식 소스로 바꾼다.
 * {name}은 values[name] 조각으로 치환하고, 나머지 글자는 정규식 특수문자를 이스케이프한다.
 */
function templateSource(template: string, values: Record<string, string> = {}): string {
  return template
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name && name in values) return values[name]!;
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
}

/** 요청 목적별로 호출 시점의 로케일 문구에 맞춰 만든 파서 */
const summaryTargetRe = () => new RegExp(templateSource(t('llm.context.summaryTarget'), { target: '([^"]+)' }));
const focusRe = () => new RegExp(templateSource(t('llm.context.targetQuestion'), { text: '([^"]+)' }));
const skillAskRe = () => new RegExp(`${templateSource(t('llm.skillAssist.requestHeading'))}\\n([\\s\\S]*)$`);
const skillHeadingRe = (name: string) =>
  new RegExp(`^${templateSource(t('llm.skill.heading'), { title: '.+', name })}$`, 'm');
const pageNoteRe = () =>
  new RegExp(
    `${templateSource(t('llm.page.noteHeading'))}\\n([\\s\\S]*?)(?:\\n${templateSource(t('llm.page.extraRequest'))}|$)`,
  );

function lastUser(req: StreamRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

/** 검색을 부르는 질문이면 검색어 (데모) */
export function mockSearchQuery(user: string): string | null {
  if (!/검색|최신|뉴스|search/i.test(user)) return null;
  return user.replace(/\s+/g, ' ').trim().slice(0, 40);
}

function focusOf(req: StreamRequest): string | null {
  const m = focusRe().exec(req.system);
  return m?.[1] ?? null;
}

/** 요청 목적과 내용에 맞는 가짜 응답 텍스트 */
export function mockAnswer(req: StreamRequest): string {
  const user = lastUser(req);
  if (req.purpose === 'title') {
    if (/어텐션|attention/i.test(user)) return t('demo.title.attention');
    const first = user.replace(/\[[^\]]+\]\s*/g, '').split(/\s+/).slice(0, 3).join(' ');
    return first || t('demo.title.fallback');
  }
  if (req.purpose === 'skill') {
    const ask = skillAskRe().exec(user)?.[1]?.trim() ?? '';
    const cur = /<prompt>\n([\s\S]*?)\n<\/prompt>/.exec(user)?.[1];
    const keep = (tag: string, fallback: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(user)?.[1] || fallback;
    return [
      `<name>${keep('name', 'quiz')}</name>`,
      `<title>${keep('title', t('demo.skill.fallbackTitle'))}</title>`,
      `<description>${keep('description', t('demo.skill.fallbackDescription'))}</description>`,
      '<prompt>',
      cur ? t('demo.skill.appendRequest', { cur, ask }) : t('demo.skill.newBody', { ask }),
      '</prompt>',
      // 부수 파일을 요청하면 참고 파일을 하나 만든다 (IMP-12)
      ...(/파일|참고|file|reference/i.test(ask)
        ? ['<file path="references/rubric.md">', t('demo.skill.rubricHeading'), t('demo.skill.rubricItem'), '</file>']
        : []),
      `<note>${cur ? t('demo.skill.noteAppended') : t('demo.skill.noteCreated')}</note>`,
    ].join('\n');
  }
  if (req.purpose === 'page') {
    // [여기에 채우기]는 pageAssist.ts의 FILL_MARK와 같은 마커 (로케일과 무관하게 고정)
    if (user.includes('[여기에 채우기]')) return t('demo.page.fillItems');
    const note = pageNoteRe().exec(user)?.[1]?.trim() ?? '';
    return `${t('demo.page.organizeHeading')}\n\n${note}`;
  }
  const canned = cannedReplies();
  if (req.purpose === 'summary') {
    const target = summaryTargetRe().exec(user)?.[1] ?? t('demo.fallbackTopic');
    const hit = canned.find((c) => c.keys.test(target));
    const gist = hit ? hit.answer.split('\n')[0]!.replace(/[*`]/g, '') : t('demo.summary.gistFallback', { target });
    return t('demo.summary.line', { gist, target });
  }
  if (user.includes(reorganizeRequest())) {
    return t('demo.reorganize');
  }
  if (skillHeadingRe('quiz').test(req.system)) return t('demo.quiz');
  if (skillHeadingRe('speak').test(req.system)) return t('demo.speak');
  const focus = focusOf(req);
  const probe = `${user} ${focus ?? ''}`;
  const hit = canned.find((c) => c.keys.test(user)) ?? canned.find((c) => c.keys.test(probe));
  if (hit) return withNext(req, hit.answer, focus ?? user);
  const target = focus ?? user.slice(0, 40);
  return withNext(req, t('demo.generic', { target }), target);
}

/** 추천 가지 지시를 받았으면 이어 갈 질문 블록을 붙인다 (ADR-094) — 이미 블록이 있으면 그대로 */
function withNext(req: StreamRequest, answer: string, topic: string): string {
  if (!req.system.includes(branchSuggestInstruction()) || answer.includes('```branches')) return answer;
  const short = topic.replace(/\s+/g, ' ').trim().slice(0, 16) || t('demo.fallbackTopic');
  const next = [
    { title: t('demo.next.example.title'), question: t('demo.next.example.question', { topic: short }) },
    { title: t('demo.next.confusion.title'), question: t('demo.next.confusion.question', { topic: short }) },
  ];
  return `${answer}\n\n\`\`\`branches\n${JSON.stringify({ chapters: [], next })}\n\`\`\``;
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
    label: opts.label ?? t('demo.label'),
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
        // 웹 검색이 켜진 대화에서 검색할 만한 질문이면 가짜 검색을 먼저 보여준다 (ADR-070, e2e용)
        const query = wantsWebTools(req) ? mockSearchQuery(lastUser(req)) : null;
        if (query) {
          yield { type: 'tool', tool: { id: 'mock-ws', name: 'web_search', status: 'running', query } };
          await sleep(500 * mockControl.speed, signal);
          yield {
            type: 'tool',
            tool: {
              id: 'mock-ws',
              name: 'web_search',
              status: 'done',
              query,
              sources: [
                { url: 'https://example.com/news', title: t('demo.search.source1') },
                { url: 'https://example.org/docs', title: t('demo.search.source2') },
              ],
            },
          };
        }
        const text = respond(req);
        const parts = chunk(text);
        const failAt = mockControl.failNext ? Math.floor(parts.length * 0.35) : -1;
        mockControl.failNext = false;
        for (let i = 0; i < parts.length; i++) {
          if (i === failAt) {
            yield { type: 'error', error: providerError('network', t('demo.error.streamCut')) };
            return;
          }
          yield { type: 'delta', text: parts[i]! };
          await sleep((14 + Math.random() * 22) * mockControl.speed, signal);
        }
        yield { type: 'done', stopReason: 'end_turn' };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          yield { type: 'error', error: providerError('aborted', t('demo.error.aborted')) };
          return;
        }
        throw e;
      }
    },
  };
}

const AVAILABILITY_KEY: Record<Availability['status'], MessageKey> = {
  ready: 'demo.availability.ready',
  offline: 'demo.availability.offline',
  'not-installed': 'demo.availability.notInstalled',
  'not-logged-in': 'demo.availability.notLoggedIn',
  'no-key': 'demo.availability.noKey',
  unpaired: 'demo.availability.unpaired',
};

export function availabilityMessage(a: Availability): string {
  return t(AVAILABILITY_KEY[a.status]);
}
