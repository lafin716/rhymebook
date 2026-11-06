import { describe, expect, it } from 'vitest';
import {
  buildFolderMetas,
  type FolderDocInput,
  matchFolders,
  normalizeFolderPath,
  parseFolderMetaFile,
  renderFolderIndexMd,
  renderFolderInfoMd,
  synonymsOf,
  toFolderMetaFile,
} from '../src/rag/folders';
import { DEFAULT_RAG_SETTINGS, FOLDER_META_VERSION, type QueryPlan } from '../src/rag';

function doc(path: string, body: string, extra: Partial<FolderDocInput> = {}): FolderDocInput {
  const headings = (body.match(/^#+\s+.+$/gm) ?? []).map((h) => h.replace(/^#+\s+/, '').trim());
  return { path, title: path.split('/').pop() ?? path, hash: `h:${path}:${body.length}`, headings, text: body, ...extra };
}

const DOCS: FolderDocInput[] = [
  doc('README.md', '# 프로젝트 개요\n\n전체 안내입니다.'),
  doc('auth/login.md', '# 로그인 흐름\n\nJWT 토큰 검증 로직과 세션 쿠키를 설명합니다. 인증 토큰 만료 처리.'),
  doc('auth/tokens/refresh.md', '# 토큰 갱신\n\n리프레시 토큰으로 액세스 토큰을 다시 발급합니다. JWT 서명 검증.'),
  doc('auth/INFO.md', '# 인증 모듈\n\n로그인·토큰·권한을 다루는 폴더입니다.\n\n## 세부\n- 항목'),
  doc('infra/k8s/ingress.md', '# Ingress 설정\n\n쿠버네티스 Ingress 라우팅 설정과 TLS 인증서.'),
  doc('infra/deploy.md', '# 배포 절차\n\n도커 이미지를 빌드하고 쿠버네티스에 배포합니다.'),
];

describe('폴더 메타데이터 빌드', () => {
  it('폴더 목록은 경로순이고 루트가 먼저 온다', () => {
    const { folders } = buildFolderMetas(DOCS);
    expect(folders.map((f) => f.path)).toEqual(['', 'auth', 'auth/tokens', 'infra', 'infra/k8s']);
  });

  it('직접 문서 수와 하위 포함 문서 수, 하위 폴더를 센다', () => {
    const { folders } = buildFolderMetas(DOCS);
    const auth = folders.find((f) => f.path === 'auth');
    expect(auth?.docCount).toBe(2); // login.md, INFO.md
    expect(auth?.totalDocs).toBe(3); // + tokens/refresh.md (루트 README 제외)
    expect(auth?.children).toEqual(['auth/tokens']);
    const root = folders.find((f) => f.path === '');
    expect(root?.totalDocs).toBe(DOCS.length);
  });

  it('사용자 메모(INFO.md)의 첫 헤딩과 첫 문단을 제목·설명으로 쓴다', () => {
    const auth = buildFolderMetas(DOCS).folders.find((f) => f.path === 'auth');
    expect(auth?.title).toBe('인증 모듈');
    expect(auth?.description).toBe('로그인·토큰·권한을 다루는 폴더입니다.');
    expect(auth?.userNotes).toEqual(['auth/INFO.md']);
  });

  it('메모가 없으면 폴더 이름과 자동 요약을 쓴다', () => {
    const infra = buildFolderMetas(DOCS).folders.find((f) => f.path === 'infra');
    expect(infra?.title).toBe('infra');
    expect(infra?.description).toContain('문서 2개');
    expect(infra?.userNotes).toBeUndefined();
  });

  it('키워드·주요 문서·동의어를 채운다 (주요 문서는 최대 10개)', () => {
    const { folders } = buildFolderMetas(DOCS);
    const k8s = folders.find((f) => f.path === 'infra/k8s');
    expect(k8s?.keyDocs).toEqual([{ path: 'infra/k8s/ingress.md', title: 'ingress.md' }]);
    const auth = folders.find((f) => f.path === 'auth');
    expect(auth?.keywords.length).toBeGreaterThan(0);
    expect(auth?.keywords.length).toBeLessThanOrEqual(12);
    expect(auth?.synonyms.length).toBeLessThanOrEqual(16);
    expect(auth?.synonyms).toContain('authentication');
    const many = Array.from({ length: 15 }, (_, i) => doc(`big/d${i}.md`, `# 제목${i}\n\n본문`));
    expect(buildFolderMetas(many).folders.find((f) => f.path === 'big')?.keyDocs).toHaveLength(10);
  });

  it('연관 폴더는 키워드가 여러 개 겹치는 다른 폴더만 (상위·하위 제외)', () => {
    const { folders } = buildFolderMetas(DOCS);
    const auth = folders.find((f) => f.path === 'auth');
    expect(auth?.related).not.toContain('auth/tokens');
    expect(auth?.related).not.toContain('');
  });

  it('같은 입력이면 같은 결과 (결정적)', () => {
    expect(buildFolderMetas(DOCS).folders).toEqual(buildFolderMetas([...DOCS].reverse()).folders);
  });

  it('경로 정규화: 앞의 ./ 와 백슬래시를 처리한다', () => {
    expect(normalizeFolderPath('./a\\b/')).toBe('a/b');
  });

  it('동의어 사전은 양방향이다', () => {
    expect(synonymsOf('인증')).toContain('auth');
    expect(synonymsOf('auth')).toContain('인증');
    expect(synonymsOf('없는단어')).toEqual([]);
  });
});

describe('증분 갱신', () => {
  it('하위 문서가 안 바뀐 폴더는 이전 결과를 재사용한다', () => {
    const first = buildFolderMetas(DOCS).folders;
    const changed = DOCS.map((d) => (d.path === 'infra/deploy.md' ? { ...d, hash: 'new-hash' } : d));
    const second = buildFolderMetas(changed, { previous: first });
    // 루트와 infra는 subtree가 바뀌므로 재계산; auth·auth/tokens·infra/k8s는 재사용
    expect(second.reused).toBe(3);
    const authBefore = first.find((f) => f.path === 'auth');
    const authAfter = second.folders.find((f) => f.path === 'auth');
    expect(authAfter).toEqual(authBefore);
    expect(second.folders.find((f) => f.path === 'infra')?.hash).not.toBe(first.find((f) => f.path === 'infra')?.hash);
  });

  it('생성기 버전이 다른 이전 결과는 재사용하지 않는다', () => {
    const first = buildFolderMetas(DOCS).folders.map((f) => ({ ...f, generator: FOLDER_META_VERSION - 1 }));
    expect(buildFolderMetas(DOCS, { previous: first }).reused).toBe(0);
  });

  it('문서가 그대로면 모든 폴더를 재사용한다', () => {
    const first = buildFolderMetas(DOCS).folders;
    expect(buildFolderMetas(DOCS, { previous: first }).reused).toBe(first.length);
  });
});

describe('폴백 검증', () => {
  const file = toFolderMetaFile(buildFolderMetas(DOCS).folders, 1700000000000);

  it('정상 파일은 그대로 통과한다', () => {
    expect(parseFolderMetaFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it('없거나 깨진 값은 null (원문 검색으로 폴백)', () => {
    expect(parseFolderMetaFile(null)).toBeNull();
    expect(parseFolderMetaFile('not json')).toBeNull();
    expect(parseFolderMetaFile({ version: FOLDER_META_VERSION, generatedAt: 1 })).toBeNull();
    const broken = JSON.parse(JSON.stringify(file));
    broken.folders[1].keywords = 'oops';
    expect(parseFolderMetaFile(broken)).toBeNull();
  });

  it('버전이 다르면 null (재생성 필요)', () => {
    expect(parseFolderMetaFile({ ...file, version: FOLDER_META_VERSION + 1 })).toBeNull();
  });
});

describe('폴더 후보 매칭 (검색 연계)', () => {
  const folders = buildFolderMetas(DOCS).folders;
  const plan = (keywords: string[], original: string): QueryPlan => ({
    original,
    rewritten: original,
    keywords,
    contextTerms: [],
    vectorText: original,
    keywordQuery: keywords,
    contextual: false,
  } as unknown as QueryPlan);

  it('질의 키워드와 맞는 폴더를 앞에 둔다', () => {
    const hints = matchFolders(folders, plan(['토큰'], '토큰 갱신은 어떻게 해?'), 'kb1');
    expect(hints[0]?.path).toBe('auth');
    expect(hints[0]?.kbId).toBe('kb1');
    expect(hints.every((h) => h.path !== '')).toBe(true);
  });

  it('동의어로도 맞는다 (auth → 인증 폴더)', () => {
    const hints = matchFolders(folders, plan(['auth'], 'auth flow'), 'kb1');
    expect(hints.map((h) => h.path)).toContain('auth');
  });

  it('관련 없는 질의는 후보가 없다', () => {
    expect(matchFolders(folders, plan(['날씨'], '오늘 날씨 어때'), 'kb1')).toEqual([]);
  });

  it('후보 수는 limit을 넘지 않는다', () => {
    expect(matchFolders(folders, plan(['토큰', '배포', '설정'], '토큰 배포 설정'), 'kb1', 1)).toHaveLength(1);
  });

  it('기본 설정 객체와 함께 쓸 수 있다 (타입 연결 확인)', () => {
    expect(DEFAULT_RAG_SETTINGS.topK).toBeGreaterThan(0);
  });
});

describe('렌더링', () => {
  const folders = buildFolderMetas(DOCS).folders;

  it('INDEX.md는 모든 폴더를 나열하고 자동 생성 안내를 담는다', () => {
    const md = renderFolderIndexMd(folders);
    expect(md).toContain('# 폴더 색인');
    expect(md).toContain('덮어써집니다');
    for (const f of folders) if (f.path) expect(md).toContain(`\`${f.path}/\``);
  });

  it('INFO.md는 제목·주요 문서·하위 폴더 섹션을 담는다', () => {
    const auth = folders.find((f) => f.path === 'auth');
    if (!auth) throw new Error('auth folder missing');
    const md = renderFolderInfoMd(auth);
    expect(md.startsWith('# 인증 모듈')).toBe(true);
    expect(md).toContain('## 주요 문서');
    expect(md).toContain('## 하위 폴더');
    expect(md).toContain('auth/tokens');
  });
});
