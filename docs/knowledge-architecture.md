# 지식베이스 아키텍처 — Codebase(Agentic) · Document(Hybrid)

ADR-127~132. 계획·진행: `docs/plans/kb-types-overhaul-plan.md`. 평가: `docs/eval/kb-types-2026-11-06.md`.
원격 지식팩 설계(미구현): `docs/knowledge-pack-architecture.md`.

## 1. 한눈에

```
세션(knowledgeIds[])
   │
   ▼
Knowledge Router (core rag/router.ts)
   ├─ codebase KB ──► Agentic 검색 (bridge codebase/*)  : 파일명 → grep → 정의 → 부분 읽기   [벡터·색인 없음]
   └─ document/미분류 ► Hybrid 검색 (bridge rag/*)      : FTS5(BM25) + 벡터 → RRF → 부모 문맥 확장
   ▼
Context Builder (core rag/contextBuilder.ts) : 중복 제거·관련성·버전 충돌·토큰 예산·출처(path:line / 문서 p.N)
   ▼
LLM 프롬프트 (<kb_content> 데이터) + 기본 스킬 "지식베이스 탐색"(skill-knowledge) + MCP 읽기 전용 도구
```

- **유형은 두 가지뿐**: `codebase` · `document` (`KnowledgeKind`, core `knowledge.ts`). 혼합(Mixed)은 유형이 아니라 세션에 두 유형이 함께 연결된 상태다.
- **미분류**(`kind` 없음): 구버전에서 넘어와 유형을 확실히 판별하지 못한 KB. 사용자가 고를 때까지 문서형으로 동작하며 UI가 유형 선택을 안내한다(`kindSuggestion`은 안내용, 자동 적용 안 함).

## 2. 데이터 소유권 (Source of Truth vs 파생)

| 위치 | 내용 | 성격 |
|---|---|---|
| `<userData>/knowledge/<kbId>/meta.json` | id·이름·설명·kind·linkedPath·excludes·색인 설정·migratedFrom | **원천** |
| `<kbId>/files/` 또는 `linkedPath`(연결 폴더) | 사용자 원본 | **원천** (앱은 읽기만, 연결 폴더는 절대 쓰지 않음) |
| `<kbId>/meta/` | 폴더 정보(INFO, ADR-123)·앱 생성 탐색 지도 | 앱 메타 |
| 세션 `knowledgeIds` | 학습 ↔ KB 연결 | **원천** (core store) |
| `<kbId>/index.sqlite` (+ `index.next.sqlite`, `index.prev.sqlite`) | 문서 청크·FTS5·벡터 BLOB | **파생** — 지워도 다시 만든다 |
| `<kbId>/backup/<ts>/` | 마이그레이션·유형 변경 때 옮긴 색인 + manifest | 롤백용 |

색인 파일을 지워도 KB 목록·원본·세션 연결·파일 메타는 그대로다. 코드베이스 KB에는 `index*.sqlite`가 존재하지 않아야 한다.

## 3. 검색 정책과 강제 지점 (Codebase Vector 금지)

판단 기준은 **KB id → meta.json `kind`** 이다. 파일 확장자가 아니다. meta.json을 읽거나 해석하지 못하면 문서형으로 간주하지 않고 색인·벡터 경로를 거부한다(`kb_meta_unreadable`, 실패 시 닫힘, ADR-133). 코드베이스 안의 README·MD·TXT도 그 KB에 속하므로 벡터화하지 않는다.

| 층 | 위치 | 동작 |
|---|---|---|
| 정책 | core `knowledgePolicy.ts` — `searchPolicyOf`, `assertIndexAllowed`, `assertVectorAllowed`, `KnowledgePolicyError` | 단일 규칙 |
| UI | `packages/ui/src/knowledge/*` | 코드베이스에 임베딩·색인 옵션을 아예 표시하지 않음 |
| IPC | `apps/desktop/src/kbGuard.ts`, `ipc.ts` | 유형 확인 후 색인 설정·재색인·검증 요청 거부 (`kb-guard:<code>: …`) |
| Store | `bridge knowledgeStore.ts` | `setIndexSettings`·reindex 거부, `setKind('codebase')` 시 색인을 backup으로 이동 |
| 색인 큐 | `bridge rag/indexer.ts`·`worker.ts` | enqueue·resume·runJob·providerFor·settingsChanged·markStale에서 `assertIndexAllowed` |
| 라우터 | `bridge rag/codebaseRetrieval.ts` + core `rag/router.ts` | 코드베이스 id는 `retrieveFrom`(벡터/FTS)으로 보내지 않음 |
| MCP | `bridge kbTools/service.ts` | 코드베이스에 `indexedSearch` 금지, agentic 도구로만 |

정량 확인(평가 하네스): 코드베이스 임베딩 호출 0, 코드베이스 색인 파일 0, 코드베이스 enqueue 거부.

## 4. Codebase — Agentic 검색 (`packages/bridge/src/codebase/*`)

- **대상 결정** (`target.ts`): 연결 폴더는 realpath로 고정, 그 밖으로 나가는 경로·심볼릭 링크는 따라가지 않음(`openSafe`). 경로는 `isKnowledgePath`로 `..`·절대 경로·제어 문자 거부.
- **파일 목록** (`listing.ts`): git 저장소면 `git -c core.fsmonitor=false -c core.hooksPath=/dev/null ls-files`(고정 인자, 셸 없음, `GIT_CONFIG_NOSYSTEM=1`·`GIT_TERMINAL_PROMPT=0` — 저장소 설정이 프로그램을 실행하지 못함), 아니면 디렉터리 순회 + `.gitignore`. 기본 제외(`DEFAULT_CODEBASE_EXCLUDES`: node_modules, dist, build, .git …) + 사용자 제외 + 바이너리(`BINARY_EXTS`)·대용량 제외.
- **단계**: 질문 → 낱말(`terms.ts`, 식별자 분해·한국어 어미 정리) → 경로/파일명 점수 → 내용 grep(리터럴 기본. 정규식은 길이 상한·역참조 금지·반복 그룹 안 한정자/선택 금지·긴 반복 2개(넓은 원자 1개) 상한·인접 겹침 반복 금지로 역추적 폭주 차단. 리터럴은 줄당 4000자, 사용자 정규식은 줄당 300자, 파일당 200ms·grep 전체 5초 상한) → 정의 패턴(`defs.ts`, 언어 무관 정규식) → 일치 줄 주변 부분 읽기(`read.ts`).
- **상한** (`CODEBASE_LIMITS`): 결과 수·파일당 읽기 크기·전체 스캔 바이트·시간. `AbortSignal`로 취소.
- **최신성**: 색인이 없으므로 매 검색이 실제 파일을 읽는다. 저장 직후 바뀐 코드가 바로 검색된다.
- **안내 문서 신뢰 경계**: INFO.md(사용자 작성) > README > AGENTS.md/CLAUDE.md 순 힌트. 모두 `<kb_content>` 데이터로만 전달하며 지시로 따르지 않는다. INFO.md가 없어도 정상 탐색. 앱은 사용자 파일을 만들거나 덮어쓰지 않는다(폴더 정보는 `<kb>/meta/`).
- **CLI 연결**: Claude/Codex CLI에는 MCP "octobooks" 서버의 읽기 전용 도구만 준다. 쓰기·셸 권한을 추가로 주지 않는다.

## 5. Document — 하이브리드 검색 (`packages/bridge/src/rag/*`)

```
원본(PDF/TXT/MD…) → 파싱(페이지·제목·표·코드 블록 보존, 스캔 PDF는 scanned_pdf 오류)
 → 구조적 청킹(제목·문단·섹션·표·코드 경계, 부모-자식 청크)
 → FTS5(BM25, unicode61 + core `tokenize`의 한국어 2-gram 보강) ┐
 → 벡터(BLOB, 공급자 추상)                          ┘→ RRF → (rerank 확장 지점) → 원문 재확인·부모 문맥 확장 → Context Builder
```

- **임베딩 공급자**: `none` / `local-hash`(신규 문서 KB 기본, 외부 전송·키 불필요) / `openai`(선택). 특정 서비스 키를 강제하지 않는다. 벡터가 꺼지거나 실패해도 BM25 키워드 검색은 계속된다(notice `keyword_only`).
- **청크 메타**: kbId·documentId·chunkId·원본 경로·문서 제목·페이지·섹션·위치·파일 해시·색인 형식 버전(`INDEX_FORMAT_VERSION`)·임베딩 모델 id.
- **저장소**: 기존 SQLite(FTS5 + 벡터 BLOB)를 유지 — 새 DB·서버 없음. 벡터 저장소를 바꿀 때는 `rag/sqliteRepository.ts`(저장)와 `embedderFor`(임베딩)만 교체한다. 도메인·세션 코드는 `retrieveForChat`/라우터 경계 뒤에 있어 영향이 없다.

## 6. 색인 관리 (문서형만)

| 기능 | API |
|---|---|
| 생성·증분(해시 비교로 변경 파일만) | 파일 추가/변경 시 자동 enqueue |
| 실패 재시도 | `reindex(id, { retryFailed: true })` |
| 부분 재색인 | `reindex(id, { paths: [...] })` |
| 전체 재생성 | `reindex(id, { full: true })` — `index.next.sqlite`에 새로 만들고 성공하면 교체, 이전 색인 삭제(원본 무관) |
| 무결성 검사 | `verifyIndex(id)` → `IndexIntegrityReport` |
| 모델·설정 변경 | 설정이 바뀌면 stale 표시 → 재색인 |
| 형식 버전 | `INDEX_FORMAT_VERSION` 불일치 시 재생성 |
| 취소 | 진행 중 작업 취소, 상태 `cancelled` |
| 재시작 복구 | 앱 시작 시 `indexer.resume()`이 미완료 작업 재개 |
| 상태·오류 | `KnowledgeIndexState` → `knowledgeReadiness()` (Empty·Loading·Ready·Indexing·Partially Ready·Failed·Rebuilding·Cancelled + 원인·조치) |

## 7. Knowledge Router · Context Builder

- `routeKnowledge(kbs, question)`: 코드베이스 → `agentic`, 문서·미분류 → `hybrid`. 둘 다 있으면 **항상 둘 다** 검색하고 `queryIntentOf`(code/document/both)는 예산 비율(`splitBudget`)만 바꾼다 — 모호한 질문에서 한 엔진을 버리지 않는다.
- 혼합 결과는 `kbTools/merge.ts`의 공정 병합(양쪽에 결과가 있으면 코드베이스 몫 ceil(limit/2) 예약, 번갈아 채움, 남는 자리는 넘김).
- `buildKnowledgeContext`: 중복 제거(`dedupeEvidence`) → 관련성 필터 → 문맥 확장 → 버전 충돌(`findVersionConflicts`, notice `version_conflict`) → 토큰 예산 → 출처 보존.
- 출처 표기 `citationLocation`: 코드 `path:시작-끝줄`, PDF `문서명 p.N`.

## 8. 기본 스킬 "지식베이스 탐색" (`skill-knowledge`)

- 정의: core `skills.ts`(`KNOWLEDGE_SKILL_ID`), 프롬프트 `i18n/locales/*/skillsBuiltin.json`의 `knowledge`(5개 언어). 구버전 프롬프트는 `skillsLegacy.ts`로 식별해 사용자가 고치지 않은 경우만 새 프롬프트로 올린다.
- 동작: 세션 연결 KB와 유형 확인 → 의도 판단 → 코드베이스는 `findFiles`·`grepKnowledge`·`findDefinitions`·`readKnowledgeFile(startLine,endLine)`로 반복 탐색, 문서는 `searchKnowledge`(하이브리드) → 원문 확인 → 출처와 함께 답변. 코드베이스에 벡터 검색을 부르지 않는다.
- 도구 안내: core `rag/tools.ts`. MCP 서버는 세션에 연결된 KB id만 허용하고 모든 결과를 데이터로 감싼다.
- 실패 처리: 결과 없음·연결 폴더 없음(`codebase_missing`)·키워드 전용(`keyword_only`)을 notice로 돌려 프롬프트가 사실대로 알리게 한다.

## 9. API / IPC (렌더러 `DesktopKnowledgeApi`, core `bridge/desktop.ts`)

`create(name, { kind, description, linkedPath, excludes })`, `pickFolder()`, `inspectFolder(path)` → `KnowledgeFolderInspection`,
`setKind(id, kind)`, `setExcludes(id, patterns)`, `reindex(id, { full, paths, retryFailed })`, `verifyIndex(id)`, `restoreIndexBackup(id)`,
기존 `list/rename/remove/addFiles/addFolder/addGithub/addLink/preview/indexState/retrieve`.
main은 모든 인자(id 형식·경로·패턴 수·유형)를 `kbGuard.ts`에서 다시 검증한다. 렌더러에 Node 권한은 없다.

## 10. 마이그레이션 (`bridge knowledgeMigration.ts`, ADR-132)

- 앱 시작 시 `indexer.resume()` 전에 실행. 마커 `<knowledge>/.kb-migration.json`(버전 `kb-types-1`), 오류가 0이고 meta.json을 읽지 못해 건너뛴 KB 폴더도 0일 때만 기록 → 아니면 다음 시작에 다시 시도. 여러 번 돌려도 결과가 같다(멱등, 중복 생성 0).
- `kind` 없는 KB마다 `classifyLegacyKnowledge`: 확실하면 kind 기록(`migratedFrom: { version, at, reason }`), 불확실하면 **그대로 둔다**(미분류, 문서형 동작 유지, UI가 추정만 표시).
- 코드베이스로 확정된 KB의 `index*.sqlite`는 삭제하지 않고 `<kb>/backup/<ts>/`로 **이동** + manifest. 색인 파일은 해당 KB 폴더(`<kbId>/`) 바로 아래의 `index*.sqlite`만 대상이며(소유 = KB id), 색인기 핸들을 먼저 놓은 뒤 옮긴다. `restoreIndexBackup(id)`로 되돌린다(대상에 색인 파일이 이미 있으면 덮어쓰지 않고 거부). `setKind`는 meta를 먼저 저장하고 색인을 옮기며, 이동 실패 시 meta를 되돌린다. `updateSource`는 직렬 잠금 안에서 KB 존재·유형 불변을 다시 확인한다.
- 원본 파일·세션 연결(`knowledgeIds`)·학습 이력은 건드리지 않는다. 문서 KB의 기존 색인은 그대로 재사용한다.

## 11. 보안

- KB 내용은 항상 `<kb_content>` 데이터. 문서 안 지시문(프롬프트 인젝션)은 따르지 않도록 스킬·시스템 프롬프트에 명시하며, 도구 자체가 읽기 전용이라 권한을 바꿀 수 없다.
- 경로 순회·심볼릭 링크 탈출·명령 인젝션 차단(셸 미사용, 고정 인자). 비밀 값(API 키)은 로그에 남기지 않는다.

## 12. 원격 지식팩 확장 지점 (이번 범위 밖)

서버·다운로드는 구현하지 않았다. 확장 지점: (1) `KnowledgeKind`별 정책은 `searchPolicyOf` 한 곳 — 팩도 같은 두 유형을 따른다, (2) 색인은 파생 데이터이므로 팩은 원본+meta만 배포하고 문서 색인은 받는 쪽에서 만든다(형식 버전·임베딩 모델 id로 호환 판단), (3) 코드베이스 팩은 색인 없이 파일만 받으면 바로 검색된다. 상세는 `docs/knowledge-pack-architecture.md`.

## 13. 사용법 (사용자)

1. 지식베이스 → **새로 만들기** → 유형 선택.
   - **코드베이스**: 폴더(또는 GitHub 주소) 선택 → 구조 미리보기 → 이름·설명·제외 경로 → 완료. 색인 없이 바로 검색된다.
   - **문서**: 파일·폴더 선택 또는 끌어 놓기 → 목록·크기·중복 확인 → 완료. 색인 진행률이 보이고 끝나면 Ready.
2. 상세 화면의 **검색 테스트**에 질문을 넣어 결과(파일·줄/페이지·검색 방식)를 확인하고 원본을 연다.
3. 학습 세션의 지식베이스 선택에서 여러 KB(코드베이스+문서)를 함께 연결한다.
4. 색인 문제: 상세 화면에서 **실패만 다시**, **전체 다시 만들기**, **무결성 검사**. 색인을 다시 만들어도 원본은 지워지지 않는다.
5. 미분류 KB는 목록에 "유형 선택 필요"가 표시된다. 유형을 고르면 그 정책이 적용된다(코드베이스로 바꾸면 기존 색인은 backup으로 옮겨진다).
