/**
 * 임베딩 제공자. 'local-hash'는 외부 전송 없는 해시 임베딩(기본), 'openai'는 Embeddings API.
 * 벡터는 모두 L2 정규화한다 (코사인 = 내적).
 */
import { defaultFetch, isAbort, thrownError, trimBase, httpError, type FetchLike } from '../providers/http';
import { OPENAI_BASE_URL } from '../providers/openai';
import { tokenize } from './tokenize';
import {
  EmbeddingError,
  type EmbeddingModelInfo,
  type EmbeddingProvider,
  type EmbeddingProviderId,
} from './types';

/** 두 벡터의 코사인 유사도 (길이가 다르면 짧은 쪽까지만, 영벡터는 0) */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) * (a[i] ?? 0);
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalizeInPlace(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += (v[i] ?? 0) * (v[i] ?? 0);
  if (n === 0) return v;
  const inv = 1 / Math.sqrt(n);
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) * inv;
  return v;
}

/** FNV-1a 32비트 (seed로 두 번째 해시를 만든다) */
function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const HASH_MODEL = 'hash-v1';

/**
 * 내장 해시 임베딩 (feature hashing). 토큰·인접 토큰쌍을 부호 있는 해시 버킷에 로그 빈도로 더한다.
 * 의미 임베딩은 아니지만 오프라인·무료·결정적이라 키워드 검색과 함께 쓰기 좋다.
 */
export function createHashEmbedder(dim = 384): EmbeddingProvider {
  const info: EmbeddingModelInfo = { provider: 'local-hash', model: HASH_MODEL, dim };

  const vectorOf = (text: string): Float32Array => {
    const v = new Float32Array(dim);
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const bg = new Map<string, number>();
    for (let i = 0; i + 1 < tokens.length; i++) {
      const key = `${tokens[i]} ${tokens[i + 1]}`;
      bg.set(key, (bg.get(key) ?? 0) + 1);
    }
    const add = (feature: string, w: number) => {
      const idx = fnv1a(feature, 0) % dim;
      const sign = fnv1a(feature, 0x9e3779b9) & 1 ? 1 : -1;
      v[idx] = (v[idx] ?? 0) + sign * w;
    };
    for (const [t, c] of tf) add(t, 1 + Math.log(c));
    for (const [b, c] of bg) add(b, 0.5 * (1 + Math.log(c)));
    return normalizeInPlace(v);
  };

  return {
    info,
    batchSize: 256,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(vectorOf);
    },
  };
}

export interface OpenAIEmbedderOptions {
  /** API 키 공급자 (저장소에서 읽는다). 키는 로그·오류 문구에 넣지 않는다 */
  getKey: () => string | null | undefined | Promise<string | null | undefined>;
  /** 기본 text-embedding-3-small */
  model?: string;
  /** 출력 차원 (text-embedding-3 계열만). 없으면 모델 기본 */
  dimensions?: number;
  baseUrl?: string;
  fetch?: FetchLike;
}

/** 입력 한 건의 최대 글자 수 (모델 토큰 한도 안쪽) */
export const OPENAI_INPUT_CHARS = 8000;

const OPENAI_DIMS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Retry-After 헤더(초 또는 HTTP 날짜)를 ms로. 없거나 해석할 수 없으면 undefined */
export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return secs >= 0 ? Math.round(secs * 1000) : undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/** text-embedding-3 계열만 dimensions 파라미터를 받는다 */
function supportsDimensions(model: string): boolean {
  return model.startsWith('text-embedding-3');
}

/** OpenAI Embeddings API (POST {base}/v1/embeddings). 문서 본문이 OpenAI로 전송된다 */
export function createOpenAIEmbedder(opts: OpenAIEmbedderOptions): EmbeddingProvider {
  const model = opts.model ?? 'text-embedding-3-small';
  const dimensions = supportsDimensions(model) && opts.dimensions && opts.dimensions > 0 ? Math.floor(opts.dimensions) : undefined;
  const dim = dimensions ?? OPENAI_DIMS[model] ?? 1536;
  const base = trimBase(opts.baseUrl ?? OPENAI_BASE_URL);
  const doFetch = opts.fetch ?? defaultFetch();
  const info: EmbeddingModelInfo = { provider: 'openai', model, dim };

  return {
    info,
    batchSize: 96,
    async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const key = await opts.getKey();
      if (!key) throw new EmbeddingError('OpenAI API 키가 없어 임베딩할 수 없습니다', false);

      let res: Response;
      try {
        res = await doFetch(`${base}/v1/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            input: texts.map((t) => t.slice(0, OPENAI_INPUT_CHARS)),
            encoding_format: 'float',
            ...(dimensions ? { dimensions } : {}),
          }),
          signal,
        });
      } catch (e) {
        if (isAbort(e)) throw e;
        const pe = thrownError(e);
        throw new EmbeddingError(pe.message, pe.code === 'offline');
      }

      if (!res.ok) {
        const pe = await httpError(res);
        const retryAfterMs = retryableStatus(res.status) ? parseRetryAfterMs(res.headers.get('retry-after')) : undefined;
        throw new EmbeddingError(pe.message, retryableStatus(res.status), retryAfterMs);
      }

      let body: { data?: { index: number; embedding: number[] }[] };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new EmbeddingError('임베딩 응답을 해석할 수 없습니다', false);
      }
      const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
      if (data.length !== texts.length) throw new EmbeddingError('임베딩 응답 개수가 요청과 다릅니다', false);
      return data.map((d) => {
        if (d.embedding.length !== dim) throw new EmbeddingError('임베딩 차원이 모델 설정과 다릅니다', false);
        return normalizeInPlace(Float32Array.from(d.embedding));
      });
    },
  };
}

/**
 * 벡터 없음('none'): 임베딩을 하지 않는다. 색인은 키워드·경로·심볼만으로 동작한다.
 * embed를 부르면 재시도하지 않는 오류를 던진다 (호출하면 안 되는 경로를 드러내기 위함).
 */
export function createNoneEmbedder(): EmbeddingProvider {
  return {
    info: { provider: 'none', model: 'none', dim: 0 },
    batchSize: 1,
    async embed() {
      throw new EmbeddingError('벡터 없이 색인된 지식베이스는 임베딩을 호출하지 않습니다', false);
    },
  };
}

/** 색인 설정(meta.json의 embedding)으로 제공자를 만든다 */
export function createEmbedder(
  settings: { provider: EmbeddingProviderId; model?: string },
  deps: { getOpenAIKey: OpenAIEmbedderOptions['getKey']; fetch?: FetchLike; baseUrl?: string },
): EmbeddingProvider {
  if (settings.provider === 'none') return createNoneEmbedder();
  if (settings.provider === 'openai') {
    return createOpenAIEmbedder({
      getKey: deps.getOpenAIKey,
      model: settings.model,
      baseUrl: deps.baseUrl,
      fetch: deps.fetch,
    });
  }
  return createHashEmbedder();
}

export interface EmbedAllOptions {
  signal?: AbortSignal;
  /** 재시도 횟수 (기본 3) */
  retries?: number;
  /** 첫 재시도 대기 ms (기본 500, 이후 두 배씩) */
  baseDelayMs?: number;
  /** 대기 함수. signal이 취소되면 일찍 끝나야 한다 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 지터 난수 (0 이상 1 미만). 기본 Math.random. 대기 시간에 최대 20%를 더한다 */
  random?: () => number;
  /** 배치 하나 끝날 때마다 (완료 개수, 전체 개수) */
  onBatch?: (done: number, total: number) => void;
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

/** 재시도 대기 상한. 서버가 아주 긴 Retry-After를 보내도 색인이 멈춘 것처럼 보이지 않게 한다 */
export const MAX_RETRY_WAIT_MS = 60_000;

/** 취소되면 바로 끝나는 대기 */
const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * 텍스트 전체를 배치로 임베딩한다. 재시도 가능한 EmbeddingError만 지수 백오프로 다시 부르고,
 * 나머지 오류·취소는 그대로 던진다.
 */
export async function embedAll(
  p: EmbeddingProvider,
  texts: string[],
  opts: EmbedAllOptions = {},
): Promise<Float32Array[]> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const out: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += p.batchSize) {
    const batch = texts.slice(i, i + p.batchSize);
    let attempt = 0;
    for (;;) {
      if (opts.signal?.aborted) throw abortError();
      try {
        const vecs = await p.embed(batch, opts.signal);
        if (vecs.length !== batch.length) throw new EmbeddingError('임베딩 개수가 입력과 다릅니다', false);
        out.push(...vecs);
        break;
      } catch (e) {
        const retryable = e instanceof EmbeddingError && e.retryable;
        if (!retryable || attempt >= retries || opts.signal?.aborted) throw e;
        const backoff = baseDelayMs * 2 ** attempt;
        const wait = Math.min(MAX_RETRY_WAIT_MS, Math.max(backoff, e instanceof EmbeddingError ? (e.retryAfterMs ?? 0) : 0));
        // 여러 배치가 같은 순간에 다시 나가지 않도록 지터를 더한다
        await sleep(Math.round(wait * (1 + 0.2 * random())), opts.signal);
        if (opts.signal?.aborted) throw abortError();
        attempt++;
      }
    }
    opts.onBatch?.(Math.min(i + batch.length, texts.length), texts.length);
  }
  return out;
}
