# 지식베이스 유형 개편 — Codebase(Agentic) · Document(Hybrid) (ADR-127~132)

## 목표
지식베이스를 "벡터 색인 문서 저장소"에서 **코드베이스 실시간 탐색 + 문서 하이브리드 검색**을 지원하는
로컬 우선 지식 플랫폼으로 바꾼다. 원본·meta.json이 원천(Source of Truth), 색인은 언제든 지우고 다시 만드는 파생 데이터.

완료 기준(관찰 가능):
- 코드베이스 KB: 임베딩 호출 0, 색인 작업 0, `index.sqlite` 0, 벡터 조회 0 — 어떤 경로(UI·IPC·색인 큐·라우터·MCP)로도.
- 문서 KB: 벡터(local-hash 기본, OpenAI 선택) + FTS5(BM25) + RRF, 임베딩 꺼져도 키워드 검색 유지.
- 세션에 두 유형이 함께 연결되면 각 정책대로 검색하고 결과만 합친다(모호한 질문은 둘 다).
- 기본 스킬 "지식베이스 탐색"의 프롬프트·도구·실제 동작이 일치.
- UI: 유형 선택 단계형 등록, 유형·상태 표시 목록(검색·필터·정렬), 상세, 검색 테스트, 세션 다중 연결 유형별 묶음.
- 마이그레이션: 확실한 것만 분류, 미분류는 기존 동작 유지, 코드베이스 색인은 백업 후 제거, 멱등.

## 현재 구조 분석 요약 (재사용 / 변경)
- 저장: `<userData>/knowledge/<kbId>/{meta.json, files/, meta/, index.sqlite}` — 그대로 재사용.
- 색인: worker_threads 색인기(`rag/indexer.ts`·`worker.ts`), SQLite FTS5 + 벡터 BLOB(v4), RRF(`searchEngine.ts`) — 문서형에 그대로.
- 임베딩: none / local-hash / openai — 공급자 추상(`embedderFor`) 유지. 특정 서비스 키 강제 없음.
- 검색 경로: store `retrieveForChat` → `indexer.retrieve` → `retrieveFrom` → 이 지점에 라우터를 끼운다.
- CLI 추가 탐색: MCP "octobooks" 서버(`kbTools/*`) 읽기 전용 4도구 → 코드베이스용 도구 3개 추가.
- 스킬: `KNOWLEDGE_SKILL_ID='skill-knowledge'`, 프롬프트는 `i18n/locales/*/skillsBuiltin.json` "knowledge".
- 변경: 유형·연결 폴더·제외 경로 메타, 정책 가드, 라우터·Context Builder, 코드베이스 엔진, UI 전면.
- 제거하지 않음: 기존 문서 색인·OpenAI 옵션·GitHub/링크 소스·폴더 INFO 메타데이터(ADR-123).

## 공통 계약 (리더 소유, 확정)
- core `knowledge.ts`: `KnowledgeKind`, `KnowledgeBase.kind/linkedPath/excludes/kindSuggestion`, `KnowledgeCreateOptions`, `KnowledgeFolderInspection`.
- core `knowledgePolicy.ts`: `searchPolicyOf`, `assertIndexAllowed`, `assertVectorAllowed`, `KnowledgePolicyError`, `canChangeKind`,
  `DEFAULT_CODEBASE_EXCLUDES`, `BINARY_EXTS`, `cleanExcludes`, `compileExcludes`, `classifyLegacyKnowledge`, `knowledgeReadiness`.
- core `rag/router.ts`: `queryIntentOf`, `routeKnowledge`, `splitBudget`.  core `rag/contextBuilder.ts`: `buildKnowledgeContext`, `citationLocation`.
- core `rag/types.ts`: `NEW_DOCUMENT_INDEX_SETTINGS`, `INDEX_FORMAT_VERSION`, `IndexJobMode`, `Evidence.method`, `SearchChannel` grep/definition/file,
  notice `keyword_only|version_conflict|codebase_missing`, `RetrievalResult.routed`, `IndexIntegrityReport`.
- core `bridge/desktop.ts`: `DesktopKnowledgeApi.create(name, opts?)`, `reindex?(id,{full,paths,retryFailed})`, `setKind?`, `setExcludes?`, `pickFolder?`, `inspectFolder?`, `verifyIndex?`, `restoreIndexBackup?`.
- bridge `knowledgeMeta.ts`: `readKbMeta`, `kindOfKb`, `filesRootOf` (연결 폴더 realpath).

## 소유권 · Task Graph
| ID | 작업 | 소유 | 의존 | 상태 |
|---|---|---|---|---|
| T1 | 공통 계약·정책·라우터·Context Builder + 테스트 | 리더 | — | DONE |
| T2 | 코드베이스 엔진 `bridge/src/codebase/*` + MCP 도구(findFiles·grepKnowledge·findDefinitions) + 연결 폴더 | Agent A | T1 | DONE |
| T3 | store(kind·linkedPath·excludes·setKind·inspectFolder) · 색인기 가드·라우팅·verify·부분 재색인 · 마이그레이션 | Agent B | T1, T2 계약 | DONE |
| T3b | IPC·preload 검증 · 시작 시 마이그레이션 · Claude/Codex CLI 읽기 전용 연결 · 원격 가드 | Agent D | T3 계약 | DONE |
| T4 | UI 전면(목록·단계형 등록·상세·검색 테스트·상태·세션 연결) + i18n + E2E | Agent C | T1 | DONE |
| T5 | 기본 스킬 프롬프트 ×5 · LEGACY 업그레이드 · 도구 안내(core rag/tools.ts) | 리더 | T2 | DONE |
| T6 | 30+ 질의 평가(성공률·R@5·지연·토큰) · docs/eval | 리더 | T2, T3 | DONE (docs/eval/kb-types-2026-11-06.md) |
| T7 | 독립 리뷰 → 수정 | Reviewer | T2–T5 | DONE (ADR-133·134) |
| T8 | 전체 검증·E2E·데스크톱 패키징 실행·문서 | 리더 | T7 | DONE (전체 검증·e2e 248 통과·앱 패키징 실행) |

파일 소유: A = `packages/bridge/src/codebase/**`, `packages/bridge/src/kbTools/**`, 해당 테스트.
B = `packages/bridge/src/knowledgeStore.ts`, `packages/bridge/src/rag/**`, `apps/desktop/src/**`, 해당 테스트.
C = `packages/ui/src/**`(knowledge·세션 연결), `packages/core/src/i18n/locales/*/knowledge.json`, `e2e/**`.
리더 = core 계약, `skillsBuiltin.json`, `rag/tools.ts`, docs.

## 핵심 설계
- **정책 강제 지점**: UI(옵션 미표시) → IPC(main: 유형 확인 후 거부) → store(setIndexSettings·reindex 거부) → 색인기 enqueue/resume/runJob/providerFor/settingsChanged/markStale(`assertIndexAllowed`) → 검색 라우터(코드베이스는 `retrieveFrom`에 넣지 않음) → MCP(`indexedSearch` 금지). 판단 기준은 **KB id → meta.json kind**, 확장자 아님.
- **코드베이스 엔진**: `git ls-files`(있으면, 고정 인자·셸 없음) 또는 디렉터리 순회 + .gitignore·기본·사용자 제외, 바이너리/대용량 제외, 심볼릭 링크 미추적, realpath 경계 확인. 단계: 경로/파일명 → 내용 grep(리터럴, 정규식은 길이·시간 제한) → 정의 패턴(언어 무관 정규식) → 일치 줄 주변 부분 읽기. 결과·읽기 상한, AbortSignal. 매번 실제 파일을 읽어 최신.
- **안내 문서 신뢰 경계**: INFO.md(사용자 작성) > README > AGENTS.md/CLAUDE.md 순 힌트. 모두 `<kb_content>` 데이터로만 전달, 지시로 따르지 않음. 자동 지도는 `<kb>/meta/codemap.json`(앱 메타)에만, 사용자 파일 미수정.
- **문서형**: 기존 파서·구조 청킹·FTS5·벡터·RRF·부모 확장 유지. 신규 문서 KB 기본 임베딩 local-hash(외부 전송 없음, 키 불필요), 꺼도 키워드 검색. 스캔 PDF는 `scanned_pdf` 오류.
- **인덱스 관리**: 증분(해시) · 실패 재시도 · 부분 재색인(paths) · 전체 재생성(next→swap, 성공 시 이전 색인 삭제 — 원본은 무관) · 무결성 검사(`verifyIndex`) · 모델 변경 시 재색인 · 형식 버전 · 취소 · 상태/오류. 원본은 절대 지우지 않음.
- **마이그레이션**(앱 시작 시, 멱등): meta.json에 kind 없으면 `classifyLegacyKnowledge` — 확실하면 kind 기록(`migratedFrom` 표시), 불확실하면 그대로(미분류=문서 동작). 코드베이스로 확정된 KB의 `index*.sqlite`는 `<kb>/backup/<ts>/`로 **이동**(삭제 아님), `restoreIndexBackup`으로 되돌림. 세션 연결(knowledgeIds) 미변경.

## 검증
- 단위: core 정책/라우터/Context Builder, bridge 코드베이스 엔진, 색인기 가드(임베딩 호출 0·레코드 0), 마이그레이션 멱등·백업, MCP 도구.
- E2E: Playwright 실제 UI(등록 단계·목록 필터·검색 테스트·다크·작은 창).
- 평가: 30+ 질의(코드/문서/혼합) 성공률·Recall@5·지연·토큰 → docs/eval/kb-types-2026-11-06.md.
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`, 데스크톱 package:dir 실행.
