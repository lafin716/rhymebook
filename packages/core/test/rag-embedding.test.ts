import { describe, expect, it } from 'vitest';
import { cosine, createEmbedder, createHashEmbedder, createOpenAIEmbedder, EmbeddingError, embedAll, embeddingKey, MAX_RETRY_WAIT_MS, parseRetryAfterMs } from '../src/rag';

describe('hash embedder', () => {
  it('차원과 단위 길이를 지키고 같은 입력은 같은 벡터다', async () => {
    const p = createHashEmbedder(384);
    expect(p.info.provider).toBe('local-hash');
    const [a, b] = await p.embed(['서브넷 마스크 CIDR', '서브넷 마스크 CIDR']);
    expect(a!.length).toBe(384);
    expect(cosine(a!, b!)).toBeCloseTo(1, 5);
  });

  it('관련 있는 문장끼리 더 가깝다', async () => {
    const p = createHashEmbedder();
    const [q, near, far] = await p.embed([
      'kubernetes pod scheduling',
      'how the kubernetes scheduler places each pod on a node',
      'baking sourdough bread with rye flour',
    ]);
    expect(cosine(q!, near!)).toBeGreaterThan(cosine(q!, far!));
  });

  it('빈 입력은 빈 결과', async () => {
    expect(await createHashEmbedder().embed([])).toEqual([]);
  });

  it('embeddingKey는 provider, model, dim을 잇는다', () => {
    expect(embeddingKey({ provider: 'local-hash', model: 'hash-v1', dim: 384 })).toBe('local-hash:hash-v1:384');
  });
});

describe('openai embedder (fake fetch)', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('요청 형식과 응답 순서를 맞춘다', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const input = JSON.parse(String(init.body)) as { input: string[] };
      // 응답을 일부러 뒤집어서 index로 정렬되는지 본다
      const data = input.input.map((_, i) => ({ index: i, embedding: [i + 1, ...new Array<number>(1535).fill(0)] })).reverse();
      return json({ data });
    };
    const p = createOpenAIEmbedder({ getKey: () => 'sk-test', fetch: fetchFn as typeof fetch });
    const out = await p.embed(['a', 'b']);
    expect(calls[0]!.url.endsWith('/v1/embeddings')).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(out[0]![0]).toBeCloseTo(1, 5);
    expect(out[1]![0]).toBeCloseTo(1, 5);
    expect(out[0]!.length).toBe(1536);
    expect(p.info.model).toBe('text-embedding-3-small');
  });

  it('키가 없으면 재시도 불가 오류', async () => {
    const p = createOpenAIEmbedder({ getKey: () => null, fetch: (async () => json({})) as unknown as typeof fetch });
    await expect(p.embed(['x'])).rejects.toMatchObject({ retryable: false });
  });

  it('429는 재시도 가능, 401은 불가', async () => {
    const p429 = createOpenAIEmbedder({ getKey: () => 'k', fetch: (async () => json({}, 429)) as unknown as typeof fetch });
    await expect(p429.embed(['x'])).rejects.toBeInstanceOf(EmbeddingError);
    await expect(p429.embed(['x'])).rejects.toMatchObject({ retryable: true });
    const p401 = createOpenAIEmbedder({ getKey: () => 'k', fetch: (async () => json({}, 401)) as unknown as typeof fetch });
    await expect(p401.embed(['x'])).rejects.toMatchObject({ retryable: false });
  });

  it('createEmbedder는 설정에 따라 고른다', () => {
    expect(createEmbedder({ provider: 'local-hash' }, { getOpenAIKey: () => null }).info.provider).toBe('local-hash');
    expect(createEmbedder({ provider: 'openai' }, { getOpenAIKey: () => null }).info.provider).toBe('openai');
  });
});

describe('embedAll', () => {
  it('배치 단위로 나눠 부르고 순서를 유지한다', async () => {
    const seen: number[] = [];
    const p = {
      info: { provider: 'local-hash' as const, model: 'x', dim: 1 },
      batchSize: 2,
      async embed(texts: string[]) {
        seen.push(texts.length);
        return texts.map((t) => new Float32Array([Number(t)]));
      },
    };
    const out = await embedAll(p, ['1', '2', '3', '4', '5']);
    expect(seen).toEqual([2, 2, 1]);
    expect(out.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('재시도 가능한 오류만 다시 부른다', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const p = {
      info: { provider: 'openai' as const, model: 'm', dim: 1 },
      batchSize: 10,
      async embed(texts: string[]) {
        n++;
        if (n < 3) throw new EmbeddingError('rate', true);
        return texts.map(() => new Float32Array([1]));
      },
    };
    const out = await embedAll(p, ['a'], { baseDelayMs: 10, random: () => 0, sleep: async (ms) => void sleeps.push(ms) });
    expect(out).toHaveLength(1);
    expect(n).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('재시도 불가 오류는 바로 던진다', async () => {
    let n = 0;
    const p = {
      info: { provider: 'openai' as const, model: 'm', dim: 1 },
      batchSize: 10,
      async embed(): Promise<Float32Array[]> {
        n++;
        throw new EmbeddingError('bad key', false);
      },
    };
    await expect(embedAll(p, ['a'], { sleep: async () => {} })).rejects.toThrow('bad key');
    expect(n).toBe(1);
  });
});

describe('openai 차원·재시도 (R-05)', () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  it('dimensions를 요청에 실어 보내고 그 차원을 키에 반영한다', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as { input: string[] };
      bodies.push(b as unknown as Record<string, unknown>);
      return json({ data: b.input.map((_, i) => ({ index: i, embedding: new Array<number>(256).fill(1) })) });
    };
    const p = createOpenAIEmbedder({ getKey: () => 'k', dimensions: 256, fetch: fetchFn as typeof fetch });
    expect(p.info.dim).toBe(256);
    expect(embeddingKey(p.info)).toBe('openai:text-embedding-3-small:256');
    const [v] = await p.embed(['a']);
    expect(v!.length).toBe(256);
    expect(bodies[0]!.dimensions).toBe(256);
  });

  it('dimensions를 주지 않으면 요청에 넣지 않고 모델 기본 차원을 쓴다', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({ data: [{ index: 0, embedding: new Array<number>(1536).fill(1) }] });
    };
    const p = createOpenAIEmbedder({ getKey: () => 'k', fetch: fetchFn as typeof fetch });
    await p.embed(['a']);
    expect('dimensions' in body).toBe(false);
    expect(p.info.dim).toBe(1536);
  });

  it('401은 재시도하지 않고 한국어 안내와 상태 코드를 담는다', async () => {
    let calls = 0;
    const p = createOpenAIEmbedder({
      getKey: () => 'k',
      fetch: (async () => {
        calls++;
        return json({ error: { message: 'Incorrect API key provided' } }, 401);
      }) as unknown as typeof fetch,
    });
    const err = await p.embed(['x']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as EmbeddingError).retryable).toBe(false);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).toMatch(/[가-힣]/);
    expect(calls).toBe(1);
  });

  it('429의 Retry-After(초)를 실어 보내고 embedAll이 그 시간 이상 기다린다', async () => {
    let n = 0;
    const fetchFn = async (_u: string, init: RequestInit) => {
      n++;
      if (n === 1) return json({}, 429, { 'retry-after': '2' });
      const b = JSON.parse(String(init.body)) as { input: string[] };
      return json({ data: b.input.map((_, i) => ({ index: i, embedding: new Array<number>(1536).fill(1) })) });
    };
    const p = createOpenAIEmbedder({ getKey: () => 'k', fetch: fetchFn as typeof fetch });
    await expect(p.embed(['x'])).rejects.toMatchObject({ retryable: true, retryAfterMs: 2000 });

    n = 0;
    const sleeps: number[] = [];
    const out = await embedAll(p, ['x'], { baseDelayMs: 10, random: () => 0, sleep: async (ms) => void sleeps.push(ms) });
    expect(out).toHaveLength(1);
    expect(sleeps).toEqual([2000]);
  });

  it('아주 긴 Retry-After도 MAX_RETRY_WAIT_MS로 자른다', async () => {
    let n = 0;
    const p = {
      info: { provider: 'openai' as const, model: 'm', dim: 1 },
      batchSize: 10,
      async embed(texts: string[]) {
        n++;
        if (n === 1) throw new EmbeddingError('rate', true, 86_400_000);
        return texts.map(() => new Float32Array([1]));
      },
    };
    const sleeps: number[] = [];
    await embedAll(p, ['a'], { random: () => 0, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([MAX_RETRY_WAIT_MS]);
  });

  it('재시도 대기 중 취소하면 기다리지 않고 AbortError로 끝난다', async () => {
    const p = {
      info: { provider: 'openai' as const, model: 'm', dim: 1 },
      batchSize: 10,
      async embed(): Promise<Float32Array[]> {
        throw new EmbeddingError('server', true);
      },
    };
    const ac = new AbortController();
    const started = Date.now();
    const run = embedAll(p, ['a'], { baseDelayMs: 30_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('5xx는 지수 백오프로 재시도하고 지터는 대기 시간을 20% 이내로 늘린다', async () => {
    let n = 0;
    const p = {
      info: { provider: 'openai' as const, model: 'm', dim: 1 },
      batchSize: 10,
      async embed(texts: string[]) {
        n++;
        if (n <= 2) throw new EmbeddingError('server', true);
        return texts.map(() => new Float32Array([1]));
      },
    };
    const sleeps: number[] = [];
    await embedAll(p, ['a'], { baseDelayMs: 100, random: () => 0.5, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([110, 220]);
  });

  it('parseRetryAfterMs는 초와 날짜 형식을 모두 읽고 나머지는 undefined', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
  });
});
