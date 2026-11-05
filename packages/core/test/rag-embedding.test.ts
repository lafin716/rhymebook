import { describe, expect, it } from 'vitest';
import { cosine, createEmbedder, createHashEmbedder, createOpenAIEmbedder, EmbeddingError, embedAll, embeddingKey } from '../src/rag';

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
    const out = await embedAll(p, ['a'], { baseDelayMs: 10, sleep: async (ms) => void sleeps.push(ms) });
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
