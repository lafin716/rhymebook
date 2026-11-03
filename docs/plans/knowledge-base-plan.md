# 학습별 지식베이스 (ADR-107) — 계획 (완료 2026-11-03)

## 목표
각 학습(루트 세션)에 별도 워크스페이스(지식베이스)를 붙여, 파일·링크·GitHub 저장소를 모아 두고 답변이 그 내용을 탐색하게 한다.

완료 기준 (관찰 가능)
1. 세션 상단에 지식베이스 버튼 → 대화상자에서 지식베이스 목록 탐색·생성·이름 변경·삭제·이 학습에 연결/해제.
2. 선택한 지식베이스의 파일 트리 탐색, 미리보기, 항목 삭제, 폴더 열기.
3. 소스 추가: 끌어다 놓기(파일·폴더), 파일 선택, 링크(웹 페이지 → 마크다운), GitHub 클론(얕은 클론).
4. 기본 스킬 "지식베이스 탐색"이 새/기존 사용자 모두에게 생긴다.
5. Claude CLI 답변이 지식베이스 폴더를 Read/Glob/Grep(읽기 전용, 폴더 안)으로 탐색하고 경로를 인용한다. Codex는 파일 목록만 받는다.

## 범위 / 범위 밖
- 데스크톱 로컬 프로필: 전체 기능.
- 원격 모드(웹·모바일이 PC 미러): 버튼은 보이되 "PC 앱에서 관리" 안내. 답변이 PC 렌더러에서 만들어지면 지식베이스가 쓰인다.
- 웹·모바일 로컬 프로필, API provider, 헤드리스 serve: 지식베이스 탐색 없음(버튼 숨김 / 무시).
- 벡터 검색·임베딩·PDF 텍스트 추출은 범위 밖 (CLI 파일 도구로 탐색).

## 유지할 동작
- 지식베이스가 없으면 claude/codex 인자·작업 폴더는 지금과 같다 (기존 테스트 유지).
- 파일·셸 도구 차단 원칙(ADR-070)은 지식베이스가 없는 요청에 그대로. 지식베이스가 있을 때만 claude에 Read,Glob,Grep을 연다(--allowedTools로 넓게 허용하지 않음 → 폴더 밖 읽기는 -p 모드에서 거부).
- 원격 기기는 PC 디스크 경로를 고르지 못한다 (knowledgeId만 오가며 헤드리스 호스트에는 저장소가 없음).

## 공통 계약 (리더 작성, 완료)
- `packages/core/src/knowledge.ts`: `KNOWLEDGE_ID_RE`, `isKnowledgeId`, `cleanKnowledgeName`, `KnowledgeBase`, `KnowledgeEntry`, `KnowledgeAddResult`, `KnowledgePreview`, `KNOWLEDGE_LIMITS`, `isKnowledgePath`, `isKnowledgeLinkUrl`, `parseGitHubRepo`.
- `Session.knowledgeId?` (루트에만), `StreamRequest.knowledgeId?`, `wantsKnowledge(req)`, `ChatStartMsg.knowledgeId?`, bridge client 전달.
- `DesktopApi.knowledge?: DesktopKnowledgeApi` (`packages/core/src/bridge/desktop.ts`).

## 소유권 / Task Graph
| Task | 내용 | 소유 파일 | 의존 | 난이도 |
|---|---|---|---|---|
| K0 | 공통 계약 | core/knowledge.ts, model.ts, provider.ts, bridge/protocol.ts, bridge/client.ts, bridge/desktop.ts | - | MEDIUM (리더) |
| K1 | bridge: knowledgeStore(파일 처리·링크·git), runChat cwd·도구, 인자, 테스트 | packages/bridge/src/knowledgeStore.ts(신규), claude.ts, codex.ts, server.ts, index.ts, bridge i18n 키, packages/bridge/test/knowledge*.test.ts | K0 | HIGH |
| K2 | desktop: IPC 채널·main 핸들러·preload·isClientMsg | apps/desktop/src/{ipc,main,preload}.ts | K0, K1 API | MEDIUM |
| K3 | core store: setSessionKnowledge, sendMessage에서 knowledgeId, 기본 스킬, 테스트 | core/store/index.ts, core/skills.ts, core 테스트 | K0 | MEDIUM |
| K4 | UI: 헤더 버튼·지식베이스 대화상자·도구 표시 이름·i18n(ko/en 등)·e2e | packages/ui/src/knowledge/*(신규), chat/SessionHeader.tsx, chat/ToolActivityList.tsx, core i18n 로케일, e2e/knowledge.spec.ts | K0, K3 | HIGH |
| K5 | 독립 리뷰 | (읽기 전용) | K1~K4 | HIGH |
| K6 | 검증·패키징·실제 앱 smoke·문서(ADR-107, PROGRESS) | docs/* | K5 | MEDIUM (리더) |

실행: K1+K2 → 에이전트 A, K3+K4 → 에이전트 B (병렬, 파일 겹침 없음. i18n 로케일 파일은 B가 소유, A는 bridge 문구 키 목록을 B에게 넘기지 않고 직접 같은 로케일 파일을 쓰면 충돌하므로 → A가 쓰는 bridge 문구는 `bridge.knowledge.*` 네임스페이스로 정하고 로케일 파일 쓰기는 A가 끝난 뒤 리더가 합친다). K5는 별도 리뷰 에이전트. 모델: 현재 Claude 모델 상속(별도 선택 안 함).

## 검증
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(기존 skill-sync-split 2건은 기존 실패).
- `pnpm --filter @branch/desktop package:dir` 후 OctoBooks.app 실행: 지식베이스 생성 → 파일 드롭·링크·GitHub 클론 → 지식베이스 탐색 스킬로 질문 → 답변에 파일 경로 인용 확인.
