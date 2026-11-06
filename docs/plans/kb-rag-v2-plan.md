# 지식베이스 RAG v2 — 평가·빠른 로컬 검색·계층 메타데이터·CLI 추가 탐색·선택형 OpenAI (ADR-121~126)

## 목표
API 키·별도 서버 없이 쓰는 로컬 지식베이스를 유지하면서, 검색 품질·속도를 **측정 기반**으로 개선하고
필요할 때만 OpenAI 의미 검색과 Codex/Claude 추가 탐색(읽기 전용 MCP 도구)을 결합한다.

## 현재 코드 재분석 결과 (보고서와 다른 점)
- 질의 확장(ADR-119)은 CJK 질문이면 **검색 전에 항상** LLM 호출(최대 8초) → 근거 충분성 판단 후로 이동.
- 검색 취소: renderer `KnowledgeRetriever`가 signal을 무시, preload·IPC·main·worker 어디에도 취소 경로 없음.
- `runAssistant`는 `req.knowledgeId = kbIds[0]` → CLI(Claude 탐색 폴더, Codex 안내)는 첫 KB만 봄. RAG 검색 자체는 전체 KB.
- `retrieveFrom`은 KB를 순차 처리하고 근거마다 `getChunk`/`getSection` 개별 조회(N+1).
- 벡터 검색은 전체 점수 계산 후 정렬(Top-K 선택 아님). local-hash는 384차원 FNV-1a.
- Claude는 `--add-dir`·Read/Glob/Grep로 원본 폴더를 직접 읽음(셸 없음). Codex는 셸 off(ADR-107) → 발췌문만.
- Codex 0.164/Claude 2.1.316 모두 stdio MCP 서버를 인자로 붙일 수 있음을 실측 확인 (Codex는 readOnlyHint 도구를 승인 없이 호출, 이벤트 `mcp_tool_call`).

## 공통 계약 (리더 소유, 먼저 확정)
- core `rag/types.ts`: provider `'none'`(NONE_EMBEDDING), `NEW_KB_INDEX_SETTINGS`, `OPENAI_EMBEDDING_MODELS`, `embedding.dimensions`,
  `RagMode`(auto/fast/deep/semantic), `RagSettings.mode/debug`, `SearchHit.pathRank/folderMatch`, `Evidence.matched`,
  `RetrievalTimings`, `RetrievalNotice`, `EvidenceAssessment`, `FolderHint`, `RetrievalResult.timings/notices/folders/assessment/semanticKbIds`, `RagTrace`.
- core `rag/tools.ts`: 4개 도구 I/O 타입·오류 코드·한도·입력 검증·예산·안내 문구.
- core `rag/sufficiency.ts`: `assessEvidence`.
- core provider/protocol: `knowledgeIds?`, `knowledgeMode?` (+ 예전 bridge용 `knowledgeId` 유지), `knowledgeIdsOf`.

## Task Graph
| ID | 내용 | 소유 | 의존 |
|---|---|---|---|
| R-01 | 공통 계약 | 리더 | — |
| R-02 | 평가 하네스·지표(core metrics)·데이터셋(합성 ko/en + 실제 저장소 grep 검증)·baseline(HEAD worktree) | Agent C | R-01 |
| R-03 | 검색 엔진: 'none' provider, 경로/제목 채널, 배치 조회(N+1 제거), 벡터 Top-K, 단계별 시간, 신호 취소 경계, KB 간 처리, matched | Agent A | R-01 |
| R-04 | 계층 메타데이터: schema v4 folders + folders_fts, 앱 관리 폴더 `meta/` INDEX.md/INFO.md, 증분, 검색 연계 | Agent A | R-03 |
| R-05 | OpenAI 임베딩: 모델별 차원·dimensions, 재시도·백오프·429, 사용량 토큰, 실패 시 FTS 유지 | Agent A | R-03 |
| R-06 | kbTools MCP stdio 서버(4도구, 읽기 전용, realpath 격리, 예산) + Codex/Claude 연동 + 파서 + 여러 KB | Agent B | R-01 |
| R-07 | 취소 IPC(requestId, cancel 채널, main AbortController 맵, worker 취소) | 리더 | R-03 |
| R-08 | store 흐름: 검색 → 충분성 → 필요할 때만 확장·재검색, 모든 KB 전달, 모드, RagTrace 기록 | 리더 | R-01 |
| R-09 | 신규 KB 기본 'none' (평가 후), 기존 KB local-hash 유지, 설정 UI | 리더 | R-02, R-03 |
| R-10 | UI: KB 설정(모드·의미 검색·모델·차원·비용 추정·외부 전송 안내·오류), 검색 과정 표시, 디버그 | 리더 | R-08 |
| R-11 | after 평가·비교 보고서 docs/eval/ | Agent C | R-03~R-05 |
| R-12 | 문서·ADR-121~126, ARCHITECTURE | 리더 | 전부 |
| R-13 | 독립 리뷰 (구현자와 다른 에이전트) | 리뷰어 | 전부 |
| R-14 | 최종 검증: typecheck·lint·test·e2e, 데스크톱 패키징·실행 스모크 | 리더 | 전부 |

## 유지할 동작
- 기존 KB의 meta.json 설정(local-hash/openai) 그대로 사용, 색인 삭제·재생성 강제 없음. schema 마이그레이션은 추가만.
- `knowledgeId` 단일 필드 계속 전송 (예전 bridge·relay 호환). 빈 KB 목록 = 지식베이스 없음, 상속 규칙 동일.
- 인용 번호·`Citation` 모양 동일. 사용자 원본 폴더에 쓰지 않음(메타데이터는 `<kbRoot>/<kbId>/meta/`).

## 롤백
- `RagSettings.mode='fast'` → CLI 도구 없음, 예전과 같은 발췌 전용. 
- MCP 도구 실행 실패/미설치 → 예전 경로(Claude --add-dir, Codex 발췌) 그대로.
- KB 임베딩을 local-hash로 바꾸면 예전 색인 방식.
- 폴더 메타데이터 오류 → 원문 검색만 (fallback).

## 검증
`pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`, `pnpm --filter @branch/bridge eval:rag`(before/after 비교), 데스크톱 패키징 실행 스모크.

## 난이도·모델
HIGH(검색 엔진·MCP 보안) — 현재 세션 모델(Opus 5.5) 상속. 별도 모델 선택 없음.
