# 마인드맵 질문 목록 · 질문 옮기기 · 별도 세션 분리 · 재정리 (ADR-066~069) 계획

## 목표
- 마인드맵 세션 노드에 토글(▾)을 두어 질문 목록을 펼친다. 제목 클릭 → 세션 창(기존), 질문 클릭 → 세션을 열고 그 질문으로 스크롤.
- 질문(턴)을 다른 세션으로 옮긴다(우클릭 메뉴 › 다른 세션으로 옮기기).
- 우클릭 › 별도 세션으로 분리: 현재 세션과 **같은 레벨**(형제, 루트면 새 루트)에 새 세션. 제목은 AI가 만든다(실패 시 질문 앞부분 유지).
- 세션마다 [재정리] 버튼: 세션 전체 질문을 하나의 질문 + 답변으로 정리. 기본 스킬 `세션 재정리`(reorganize)로 동작. 기존 본문에서 파생된 하위 세션(앵커 가지)은 각주로 바뀐다.
- 스킬 관리에서 기본 스킬에 "기본 스킬" 배지.

## 범위 밖
- 여러 질문 동시 선택 이동, 재정리 되돌리기(취소 시 원본 유지로 대신).

## 계약
- core `turns.ts`: `planTurnMove(sessions, messages, sessionId, questionId, targetId)`, `turnMoveTargets(sessions, messages, sessionId, questionId)`.
- core `context.ts`: `buildReorganizeRequest(opts, notes, skill)`, `parseReorganized(text)`.
- core `skills.ts`: `REORGANIZE_SKILL_ID = 'skill-reorganize'`, defaultSkills 끝에 추가(기존 사용자는 `skillsToSeed`로 자동 추가).
- store: `moveTurn(sessionId, questionId, targetId)`, `splitTurn(..., { sibling })` → 형제 분리 후 AI 제목, `reorganizeSession(sessionId, skill?)`.
- sync: `turn.move`, `turn.splitOut`, `session.reorganize` (기능 `turns`; 옛 PC면 outdated).

## 작업 (리더 단독·순차, 독립 리뷰만 서브에이전트)
| ID | 내용 | 의존 | 난이도 | 상태 |
|---|---|---|---|---|
| T1 | core turns/context/skills + 테스트 | - | MEDIUM | DONE |
| T2 | store 액션(moveTurn·형제 분리·aiTitle·reorganize) + 테스트 | T1 | HIGH | DONE |
| T3 | sync op 3종(validate/host/client) + 테스트 | T2 | MEDIUM | DONE |
| T4 | UI: 우클릭 메뉴·이동 선택·재정리 버튼·기본 스킬 배지 | T2 | MEDIUM | DONE |
| T5 | UI: 마인드맵 질문 목록 토글·질문 이동 | T1 | MEDIUM | DONE |
| T6 | E2E(desktop+mobile), 문서(ADR·PROGRESS) | T4,T5 | LOW | DONE |
| T7 | 독립 리뷰 → 수정 → 검증 → 데스크톱 패키징 실행 → 커밋 | T6 | MEDIUM | DONE |

## 모델
- 난이도 HIGH(T2), 그 외 MEDIUM/LOW. 모델은 현재 세션(Claude Opus 5.5) 상속, 별도 선택 없음. 리뷰는 독립 서브에이전트.

## 검증
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(신규 spec), 데스크톱 package:dir 후 실행.
