import { describe, expect, it } from 'vitest';
import {
  assertIndexAllowed,
  assertVectorAllowed,
  canChangeKind,
  classifyLegacyKnowledge,
  cleanExcludes,
  compileExcludes,
  DEFAULT_CODEBASE_EXCLUDES,
  KnowledgePolicyError,
  knowledgeReadiness,
  searchPolicyOf,
} from '../src';
import { buildKnowledgeContext, citationLocation, dedupeEvidence, findVersionConflicts, queryIntentOf, routeKnowledge, splitBudget, type Evidence, type KnowledgeIndexState } from '../src/rag';

describe('검색 정책 (ADR-127)', () => {
  it('코드베이스는 agentic이고 벡터·색인을 허용하지 않는다', () => {
    expect(searchPolicyOf('codebase')).toEqual({ method: 'agentic', vectorAllowed: false, indexAllowed: false });
    expect(searchPolicyOf('document').method).toBe('hybrid');
    expect(searchPolicyOf(undefined).method).toBe('hybrid');
  });
  it('코드베이스 색인·벡터 요청은 예외를 던진다', () => {
    expect(() => assertIndexAllowed('kbabcdef', 'codebase')).toThrow(KnowledgePolicyError);
    expect(() => assertVectorAllowed('kbabcdef', 'codebase')).toThrow(/vector/);
    expect(() => assertIndexAllowed('kbabcdef', 'document')).not.toThrow();
    expect(() => assertIndexAllowed('kbabcdef', undefined)).not.toThrow();
    try {
      assertIndexAllowed('kbabcdef', 'codebase');
    } catch (e) {
      expect((e as KnowledgePolicyError).code).toBe('codebase_index_forbidden');
    }
  });
  it('연결 폴더 코드베이스는 문서형으로 바꿀 수 없다', () => {
    expect(canChangeKind({ kind: 'codebase', linkedPath: '/x' }, 'document')).toBe(false);
    expect(canChangeKind({ kind: 'codebase' }, 'document')).toBe(true);
    expect(canChangeKind({ kind: undefined }, 'codebase')).toBe(true);
  });
});

describe('제외 경로', () => {
  it('정리: 상위 경로·절대 드라이브·주석·중복 제거', () => {
    expect(cleanExcludes(['dist/', '../x', 'C:/a', '# c', 'dist/', ' logs ', 5])).toEqual(['dist/', 'logs']);
  });
  it('gitignore 꼴 판정', () => {
    const m = compileExcludes([...DEFAULT_CODEBASE_EXCLUDES, '/secret.txt', 'docs/**/*.tmp', '*.log', '!keep.log']);
    expect(m('node_modules', true)).toBe(true);
    expect(m('packages/a/node_modules', true)).toBe(true);
    expect(m('node_modules', false)).toBe(false);
    expect(m('dist', true)).toBe(true);
    expect(m('src/app.min.js', false)).toBe(true);
    expect(m('secret.txt', false)).toBe(true);
    expect(m('a/secret.txt', false)).toBe(false);
    expect(m('docs/x/y/z.tmp', false)).toBe(true);
    expect(m('err.log', false)).toBe(true);
    expect(m('keep.log', false)).toBe(false);
    expect(m('src/index.ts', false)).toBe(false);
  });
});

describe('구버전 KB 유형 판별 (확실할 때만)', () => {
  it('문서 확장자만 → document', () => {
    expect(classifyLegacyKnowledge({ sourceTypes: ['files'], paths: ['a.pdf', 'b/c.md', 'd.txt'] })).toEqual({ certain: true, kind: 'document' });
  });
  it('GitHub 저장소만 + 코드 → codebase', () => {
    const r = classifyLegacyKnowledge({ sourceTypes: ['github'], paths: ['repos/k8s/go.mod', 'repos/k8s/main.go', 'repos/k8s/README.md'] });
    expect(r).toEqual({ certain: true, kind: 'codebase' });
  });
  it('표지 파일 + 코드 과반 → codebase', () => {
    const r = classifyLegacyKnowledge({ sourceTypes: [], paths: ['package.json', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'README.md'] });
    expect(r.kind).toBe('codebase');
    expect(r.certain).toBe(true);
  });
  it('혼합은 미분류로 두고 추정만 한다', () => {
    const r = classifyLegacyKnowledge({ sourceTypes: ['files', 'web'], paths: ['a.ts', 'b.ts', 'c.pdf'] });
    expect(r.certain).toBe(false);
    expect(r.kind).toBeUndefined();
    expect(r.suggestion?.kind).toBe('codebase');
  });
  it('빈 KB는 판별하지 않는다', () => {
    expect(classifyLegacyKnowledge({ sourceTypes: [], paths: [] })).toEqual({ certain: false });
  });
  it('GitHub이어도 웹 링크와 섞이면 미분류', () => {
    expect(classifyLegacyKnowledge({ sourceTypes: ['github', 'web'], paths: ['repos/a/x.go', 'web/p.html'] }).certain).toBe(false);
  });
});

const st = (p: Partial<KnowledgeIndexState>): KnowledgeIndexState => ({
  kbId: 'kbabcdef',
  status: 'ready',
  docCount: 3,
  chunkCount: 10,
  failedDocs: 0,
  ...p,
} as KnowledgeIndexState);

describe('화면 상태', () => {
  const doc = { kind: 'document' as const, fileCount: 3 };
  it('코드베이스는 색인 없이 ready, 비면 empty', () => {
    expect(knowledgeReadiness({ kind: 'codebase', fileCount: 5 }, undefined).readiness).toBe('ready');
    expect(knowledgeReadiness({ kind: 'codebase', fileCount: 0 }, undefined).readiness).toBe('empty');
    expect(knowledgeReadiness({ kind: 'codebase', fileCount: 5 }, st({ status: 'error', error: 'gone' })).readiness).toBe('failed');
  });
  it('문서 상태 전이', () => {
    expect(knowledgeReadiness(doc, undefined).readiness).toBe('loading');
    expect(knowledgeReadiness(doc, st({})).readiness).toBe('ready');
    expect(knowledgeReadiness(doc, st({ status: 'indexing', docCount: 0, chunkCount: 0 })).readiness).toBe('indexing');
    expect(knowledgeReadiness(doc, st({ status: 'indexing', progress: { mode: 'full' } as never })).readiness).toBe('rebuilding');
    expect(knowledgeReadiness(doc, st({ failedDocs: 1 })).readiness).toBe('partial');
    expect(knowledgeReadiness(doc, st({ status: 'error', docCount: 0, chunkCount: 0, error: 'x' })).readiness).toBe('failed');
    expect(knowledgeReadiness(doc, st({ status: 'empty', docCount: 0, chunkCount: 0, lastJob: { mode: 'incremental', outcome: 'cancelled', at: 1 } })).readiness).toBe('cancelled');
    expect(knowledgeReadiness({ ...doc, fileCount: 0 }, st({ docCount: 0, chunkCount: 0, status: 'empty' })).readiness).toBe('empty');
  });
  it('미분류는 준비돼도 유형 선택을 안내한다', () => {
    expect(knowledgeReadiness({ kind: undefined, fileCount: 3 }, st({})).readiness).toBe('needsKind');
  });
});

describe('Knowledge Router (ADR-131)', () => {
  it('질문 의도', () => {
    expect(queryIntentOf('syncPod 함수는 어디서 호출돼?')).toBe('code');
    expect(queryIntentOf('이 문서 3장의 개념 요약해줘')).toBe('document');
    expect(queryIntentOf('Pod Scheduling은 어떻게 동작하나요?')).toBe('both');
  });
  it('유형별로 나누고 모호하면 둘 다 같은 비율', () => {
    const r = routeKnowledge([{ id: 'kbcode01', kind: 'codebase' }, { id: 'kbdocs01', kind: 'document' }, { id: 'kbold001' }, { id: 'kbcode01', kind: 'codebase' }], '스케줄링 동작');
    expect(r.agentic).toEqual(['kbcode01']);
    expect(r.hybrid).toEqual(['kbdocs01', 'kbold001']);
    expect(r.weights).toEqual({ agentic: 0.5, hybrid: 0.5 });
  });
  it('의도가 기울어도 다른 쪽 예산은 0이 아니다', () => {
    const r = routeKnowledge([{ id: 'kbcode01', kind: 'codebase' }, { id: 'kbdocs01', kind: 'document' }], 'parseConfig() 구현');
    expect(r.intent).toBe('code');
    const b = splitBudget(8, r);
    expect(b.agentic).toBeGreaterThan(b.hybrid);
    expect(b.hybrid).toBeGreaterThan(0);
  });
  it('한 유형만 있으면 그쪽이 전부', () => {
    const r = routeKnowledge([{ id: 'kbcode01', kind: 'codebase' }], '이 문서 요약');
    expect(splitBudget(6, r)).toEqual({ agentic: 6, hybrid: 0 });
  });
  it('예산이 1이어도 두 유형 모두 1개씩 받는다 (한 엔진을 버리지 않음)', () => {
    const r = routeKnowledge([{ id: 'kbcode01', kind: 'codebase' }, { id: 'kbdocs01', kind: 'document' }], 'parseConfig() 구현');
    expect(splitBudget(1, r)).toEqual({ agentic: 1, hybrid: 1 });
    expect(splitBudget(2, r)).toEqual({ agentic: 1, hybrid: 1 });
  });
});

const ev = (p: Partial<Evidence>): Evidence => ({
  n: 0,
  kbId: 'kbcode01',
  kbName: 'code',
  chunkId: 'c',
  docId: 'd',
  path: 'a.ts',
  title: 'a.ts',
  kind: 'code',
  headingPath: [],
  text: 'x'.repeat(50),
  score: 1,
  ...p,
});

describe('Context Builder', () => {
  it('겹치는 줄 범위는 합친다', () => {
    const r = dedupeEvidence([
      ev({ chunkId: 'code:a.ts#L1-20', lineStart: 1, lineEnd: 20, score: 0.9, matched: ['grep'] }),
      ev({ chunkId: 'code:a.ts#L15-30', lineStart: 15, lineEnd: 30, score: 0.5, matched: ['definition'] }),
      ev({ chunkId: 'code:a.ts#L40-50', lineStart: 40, lineEnd: 50, score: 0.4 }),
    ]);
    expect(r.items.length).toBe(2);
    expect(r.merged).toBe(1);
    expect(r.items[0]!.matched).toEqual(['grep', 'definition']);
  });
  it('두 유형 결과를 예산대로 섞고 번호를 다시 매긴다', () => {
    const code = [1, 2, 3, 4].map((i) => ev({ chunkId: `code:f${i}.ts#L1-5`, path: `f${i}.ts`, lineStart: 1, lineEnd: 5, score: 10 - i, method: 'agentic' }));
    const docs = [1, 2, 3, 4].map((i) => ev({ kbId: 'kbdocs01', chunkId: `d${i}`, path: `g${i}.pdf`, page: i, kind: 'pdf', score: 0.05 - i * 0.001, method: 'hybrid' }));
    const route = routeKnowledge([{ id: 'kbcode01', kind: 'codebase' }, { id: 'kbdocs01', kind: 'document' }], 'Pod Scheduling');
    const r = buildKnowledgeContext([...code, ...docs], route, { maxItems: 4, maxChars: 10_000 });
    expect(r.evidence.length).toBe(4);
    expect(r.evidence.filter((e) => e.method === 'agentic').length).toBe(2);
    expect(r.evidence.filter((e) => e.method === 'hybrid').length).toBe(2);
    expect(r.evidence.map((e) => e.n)).toEqual([1, 2, 3, 4]);
  });
  it('무관(상대 점수 낮음) 결과는 뺀다', () => {
    const r = buildKnowledgeContext([ev({ chunkId: 'a', path: 'a', score: 1, method: 'hybrid' }), ev({ chunkId: 'b', path: 'b', score: 0.05, method: 'hybrid' })], undefined, { maxItems: 5, maxChars: 5000 });
    expect(r.evidence.length).toBe(1);
    expect(r.dropped).toBe(1);
  });
  it('글자 예산을 넘지 않는다', () => {
    const items = [1, 2, 3].map((i) => ev({ chunkId: `c${i}`, path: `p${i}`, text: 'y'.repeat(1000), score: 1, method: 'hybrid' }));
    const r = buildKnowledgeContext(items, undefined, { maxItems: 5, maxChars: 1500 });
    expect(r.evidence.reduce((s, e) => s + e.text.length, 0)).toBeLessThanOrEqual(1500);
  });
  it('남은 예산이 최소 길이보다 작아도 넘지 않는다', () => {
    const items = [1, 2].map((i) => ev({ chunkId: `c${i}`, path: `p${i}`, text: 'y'.repeat(500), score: 1, method: 'hybrid' }));
    for (const maxChars of [50, 120, 501, 700]) {
      const r = buildKnowledgeContext(items, undefined, { maxItems: 5, maxChars });
      expect(r.evidence.reduce((s, e) => s + e.text.length, 0)).toBeLessThanOrEqual(maxChars);
    }
  });
  it('서로 다른 출처의 버전 충돌을 알린다', () => {
    const a = ev({ docId: 'd1', text: 'Requires Kubernetes v1.28 or later' });
    const b = ev({ kbId: 'kbdocs01', docId: 'd2', text: 'Tested with Kubernetes 1.24' });
    expect(findVersionConflicts([a, b])).toEqual(['kubernetes']);
    expect(findVersionConflicts([a, ev({ docId: 'd1', text: 'Kubernetes 1.24 was older' })])).toEqual([]);
    const r = buildKnowledgeContext([{ ...a, method: 'agentic' }, { ...b, path: 'b.pdf', method: 'hybrid' }], undefined, { maxItems: 4, maxChars: 4000 });
    expect(r.notices).toEqual([{ code: 'version_conflict' }]);
  });
  it('출처 위치 표기', () => {
    expect(citationLocation({ path: 'pkg/a.go', lineStart: 10, lineEnd: 20 })).toBe('pkg/a.go:L10-20');
    expect(citationLocation({ path: 'x.pdf', title: '가이드', page: 3 })).toBe('가이드 p.3');
    expect(citationLocation({ path: 'n.md' })).toBe('n.md');
  });
});

describe('grep 정규식 안전성 (역추적 폭주 방지)', () => {
  it('위험한 반복 그룹은 거부한다', async () => {
    const { isSafeRegexSource } = await import('../src/rag/tools');
    for (const bad of ['(a+)+', '(a|a)*c', '((ab)*)+', '(x+x+)+y', '(a|b){2,}', '(\\w+\\s?)*$', '(a)\\1', '(?<n>a)\\k<n>', '(a', 'a)', '.*.*.*.*X', '.*.*X', '\\S+\\S+x', '[^a]*[^b]*c', '\\w+\\w+\\w+X', 'a.{0,500}b.{0,500}c', '\\w+.*X', '\\d+\\d*x']) {
      expect(isSafeRegexSource(bad), bad).toBe(false);
    }
  });
  it('일반 정규식은 허용한다', async () => {
    const { isSafeRegexSource } = await import('../src/rag/tools');
    for (const ok of ['func\\s+\\w+', 'class (Foo|Bar)', '(foo|bar)?baz', 'a{2}', '[(|)]+x', 'export (async )?function', 'v\\d+\\.\\d+', 'import .* from', 'TODO.*fix', '[\\w*]+x', 'a.{0,10}b.{0,10}c', 'foo\\s*\\(', 'def \\w+']) {
      expect(isSafeRegexSource(ok), ok).toBe(true);
    }
  });
});
