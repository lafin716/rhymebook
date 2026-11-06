import { describe, expect, it } from 'vitest';
import { buildExpandRequest, DEFAULT_RAG_SETTINGS, EXPAND_KEYWORDS, EXPAND_MAX_TERMS, expandPlan, lexicalReranker, needsExpansion, parseExpandTerms, rewriteQuery } from '../src/rag';

const plan = () => rewriteQuery({ question: '파드가 죽으면 다시 살리는 코드 찾아줘', parentTitles: [], parentSummaries: [], recentUser: [], recentAssistant: [], kbNames: [] });

describe('needsExpansion', () => {
  it('한글·한자·가나가 있으면 확장한다', () => {
    expect(needsExpansion('재시작 코드')).toBe(true);
    expect(needsExpansion('再起動')).toBe(true);
    expect(needsExpansion('where is syncReplicaSet')).toBe(false);
  });
});

describe('buildExpandRequest', () => {
  it('search 목적과 상한을 담은 시스템 지시를 만든다', () => {
    const req = buildExpandRequest(plan());
    expect(req.purpose).toBe('search');
    expect(req.system).toContain(String(EXPAND_MAX_TERMS));
    expect(req.messages.at(-1)?.content).toContain('파드');
    expect(req.knowledgeId).toBeUndefined();
  });
});

describe('parseExpandTerms', () => {
  it('목록 기호·번호·따옴표·()를 벗기고 형식이 맞는 것만 중복 없이 남긴다', () => {
    const raw = '- ShouldContainerBeRestarted\n2. `syncReplicaSet()`\n"kubelet", pkg/kubelet/kuberuntime; restart\nRestart\n재시작\nthis is a sentence';
    expect(parseExpandTerms(raw)).toEqual(['ShouldContainerBeRestarted', 'syncReplicaSet', 'kubelet', 'pkg/kubelet/kuberuntime', 'restart']);
  });

  it('상한까지만 받는다', () => {
    const raw = Array.from({ length: 40 }, (_, i) => `term_${i}`).join('\n');
    expect(parseExpandTerms(raw)).toHaveLength(EXPAND_MAX_TERMS);
  });
});

describe('expandPlan', () => {
  it('확장어를 검색 계획에 더하고 한국어 핵심어는 문맥어로 옮긴다', () => {
    const p = plan();
    const out = expandPlan(p, ['ShouldContainerBeRestarted', 'kubelet']);
    expect(out.rewritten).toContain('ShouldContainerBeRestarted');
    expect(out.vectorText).toContain('kubelet');
    expect(out.keywords).toEqual(expect.arrayContaining(['kubelet', 'shouldcontainerberestarted']));
    expect(out.keywords.some((k) => /[가-힣]/.test(k))).toBe(false);
    expect(out.keywordQuery).toEqual(expect.arrayContaining([...p.keywordQuery, 'kubelet']));
    expect(out.contextTerms.length).toBeGreaterThanOrEqual(p.contextTerms.length);
  });

  it('흔한 코드 낱말·짧은 토큰은 빼고, 핵심어는 상한까지만 (나머지는 문맥어)', () => {
    const p = plan();
    const many = Array.from({ length: 12 }, (_, i) => `ident${i}x`);
    const out = expandPlan(p, ['func', 'go', 'err', ...many]);
    expect(out.keywordQuery).not.toContain('func');
    expect(out.keywordQuery).not.toContain('go');
    expect(out.keywordQuery).toEqual(expect.arrayContaining(many.map((m) => m.toLowerCase())));
    expect(out.keywords).toHaveLength(EXPAND_KEYWORDS);
    expect(out.contextTerms).toEqual(expect.arrayContaining(['ident11x']));
    expect(expandPlan(p, ['func', 'go'])).toBe(p);
  });

  it('확장 뒤에는 식별자가 맞는 코드 청크가 무관한 청크보다 높고, 최종 점수가 최소 관련도를 넘는다', () => {
    const out = expandPlan(plan(), ['ShouldContainerBeRestarted', 'computePodActions', 'kuberuntime', 'restartPolicy', 'backoff', 'SyncPod', 'kubelet', 'crashloop']);
    const code = { hit: { id: 'a' } as never, text: 'func ShouldContainerBeRestarted(c *Container) bool { // kubelet restart', title: 'helpers.go', headingPath: [] };
    const other = { hit: { id: 'b' } as never, text: 'func TestCPUAllocation(t *testing.T) { cpus := 4 }', title: 'cpu_test.go', headingPath: [] };
    const [a, b] = lexicalReranker.rerank(out, [code, other]);
    expect(a!.score).toBeGreaterThan(b!.score);
    // selectEvidence 점수 = 0.5 × 상대 점수 + 0.5 × 커버리지: 같은 검색 점수(상대 1)면 최소 관련도(0.15)를 넉넉히 넘는다
    expect(0.5 * 1 + 0.5 * a!.score).toBeGreaterThan(DEFAULT_RAG_SETTINGS.minScore);
    expect(a!.score).toBeGreaterThan(0);
  });

  it('확장어가 없으면 그대로 돌려준다', () => {
    const p = plan();
    expect(expandPlan(p, [])).toBe(p);
  });
});
