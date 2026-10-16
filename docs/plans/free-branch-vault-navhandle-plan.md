# 직접 만든 하위 세션(각주) · 보관함 · 모바일 내비 핸들 (IMP-22~24)

- 모드: Project Orchestration(간이). 3개 독립 영역. 모델 inherit(현재 Claude), effort default.
  - IMP-22 직접 만든 하위 세션 — HIGH (core 모델·맥락·동기화 계약 변경) — lead 직접
  - IMP-23 보관함 — HIGH (새 저장 엔터티 + 동기화 + 새 화면) — executor 서브에이전트(worktree 격리) → lead 병합
  - IMP-24 모바일 내비 핸들·숨기기 — MEDIUM (ui만) — lead 직접
  - 독립 리뷰 — reviewer 서브에이전트(구현자와 분리)
- 유지할 동작: 앵커 가지 생성·동기화, 기존 저장 데이터(Dexie v4 이하), 데스크톱 ChatNav 레이아웃, 기존 sync 프로토콜 호환(구 클라이언트의 branch op 그대로 유효).

## IMP-22 계약
- `Session.anchor`가 없고 `parentId`가 있으면 "직접 만든 하위 세션"(각주). 모델 변경 없음.
- core store: `createSubSession(parentId, question, ids?) → ID | false` — 제목은 질문 앞 24자, provider·modelPref 상속, 첫 질문 자동 전송.
- core `context.ts`: 앵커 없는 하위 세션도 맥락 상속 — 조상 경로 + 부모 대화 최근 N개(전체 기준) + 지시문(부모 주제와 관련된 사용자 질문).
- core `tree.ts`: `footnoteChildren(sessions, parentId)` — 앵커 없는 자식, createdAt 순.
- sync: 새 op `{kind:'subsession'; id; parentId; question; messageId}` (branch op은 그대로).
- ui: 사이드바 모든 행(루트·가지) 우측 [+] → "하위 세션 만들기" 대화상자(질문 입력) → 생성 후 기본 열기 위치로 연다. 모바일은 항상 보임.
- 부모 세션 대화 끝에 "각주" 목록(`[1] 제목 · 요약 배지`), 누르면 연다. ChatNav 가지 패널 하단에 "각주" 섹션 고정.

## IMP-23 계약 (보관함)
- core `vault.ts`: `VaultNode = VaultFolder | VaultItem | VaultPage` (공통 `id, parentId(폴더 id | null), name, createdAt, updatedAt`).
  - item `kind:'item'`, `item: {type:'text', text} | {type:'image', attachment} | {type:'audio', text, lang}` + `source?: {sessionId, messageId}`.
  - page `kind:'page'`, `blocks: ({id, itemId} | {id, text})[]`.
- 저장: AppData `vault: Record<ID, VaultNode>`, Dexie v5 `vault` 테이블, 백업 스냅샷 포함.
- 동기화: op `vault.put {node}` / `vault.delete {ids}`, 서버 `sync.vault` / snapshot `vault?`.
- 보관 진입점: 답변 메시지 [보관], 선택 메뉴 [보관](선택 글), 이미지 첨부 [보관], 읽기 카드 줄/전체 [보관](음성 = 글+언어, 재생은 현재 읽기 엔진).
- 화면: TopBar [보관함] → overlay `vault`. 폴더 트리(만들기·이름 바꾸기·이동·삭제) + 미리보기 + 페이지 편집(조각 추가·글 블록·위아래 이동·삭제, 보기 모드).

## IMP-24 계약 (모바일 < 768px)
- ChatNav 도구 묶음을 세로로 바꾸고 맨 위 핸들(grip)로 끌어 옮김. 놓으면 가까운 좌/우 가장자리로 애니메이션 스냅, 세로 위치는 자유(패널 안으로 제한).
- 핸들 탭 → 메뉴 [숨기기]. 숨기면 세션 헤더의 provider 선택 오른쪽에 내비 아이콘 버튼, 누르면 다시 표시.
- 상태(위치·숨김)는 기기별 localStorage `branch.navDock`, 모든 패널 공유.

## 검증
`pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(새 spec: subsession, vault, nav-handle mobile), 패키지 데스크톱 앱 실행.
