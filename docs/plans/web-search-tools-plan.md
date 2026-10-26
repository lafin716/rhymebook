# 웹 검색 · 도구 사용 계획 (ADR-070)

- 난이도: HIGH (core·bridge·sync·ui 여러 패키지, 외부 CLI/API 출력 형식 파싱)
- 모델: claude-opus-5-5 (현재 세션 모델 상속, 별도 선택 없음). 리뷰는 독립 서브에이전트.

## 목표
대화 중 모델이 필요하다고 판단하면 웹 검색·웹 페이지 읽기 도구를 쓰고, 사용 내역(검색어·URL·출처)을 답변 위에 보여준다.

## 범위
- 도구: `web_search`, `web_fetch`만. 파일·셸 도구는 계속 비활성(03-PROVIDERS 원칙 5 유지).
- 적용: 일반 대화(purpose 없음/'chat')만. 요약·제목·스킬·재정리는 도구 없이.
- 세션별 토글 `Session.webSearch` (기본 켜짐, `false` = 꺼짐). 원격(sync)도 `session.agent` 연산으로 같이 바뀐다.
- provider 별:
  - Anthropic API: 서버 도구 `web_search_20260209`·`web_fetch_20260209`, `pause_turn` 이어 받기(최대 5회).
  - Claude CLI: `--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch`, stream-json의 tool_use/tool_result 파싱.
  - Codex CLI: `-c web_search=live`, `item.started/completed` 의 `web_search` 항목 파싱.
  - OpenAI API(Chat Completions): 미지원(칩 숨김).
  - Mock: "검색/최신/오늘/뉴스/search"가 있으면 가짜 검색 이벤트(e2e용).

## 공통 계약
- `ToolActivity { id, name, status: 'running'|'done'|'error', query?, url?, sources?: {url,title?}[] }` (core/model.ts)
- `StreamRequest.webSearch?: boolean`, `StreamEvent | { type:'tool'; tool: ToolActivity }`
- `Message.tools?: ToolActivity[]` — 같은 id면 갱신(upsert)
- bridge: `ChatStartMsg.webSearch?`, 서버 메시지 `chat.tool`
- sync: `session.agent` 에 `webSearch?: boolean`

## 유지할 동작
- 기존 텍스트·이미지 스트림, codex 스레드 처리, 요약/제목 요청은 그대로.
- 기존 저장 데이터 호환(필드 없음 = 켜짐, tools 없음 = 표시 없음).

## 검증
- 단위: anthropic 도구 파싱·pause_turn, claude/codex 파서(실제 캡처 줄), bridge client tool 이벤트, sync 검증, store upsert/토글.
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`.
- 데스크톱 앱 재빌드·실행.
