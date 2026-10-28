# 캔버스(필기) 계획 — ADR-079

## 목표
- 새로 만들기에서 **캔버스**를 만든다. 학습 시작 화면의 [캔버스로 시작]·[캔버스], 사이드바 하위 [+]의 [캔버스]에서 연다.
- 펜(필압)·형광펜·지우개로 손글씨를 쓴다.
- 가져오기: 이미지 파일·붙여넣기·끌어 놓기, 대화 세션 내용, 페이지 내용, 보관함 항목. 가져온 자료 위에 필기한다.

## 범위·유지할 동작
- 저장은 페이지와 같은 문서 세션(ADR-072)이다. `kind: 'canvas'`이고, 문서 메시지 본문이 `CanvasDoc` JSON이다.
- 트리·동기화·삭제·백업 경로는 그대로 쓴다.
- 대화 기능(질문·재시도·분리·이동·재정리)은 페이지처럼 막는다.
- 맥락·요약·검색·학습 내보내기에는 JSON 대신 `canvasText`(카드 글·이미지 이름·획 수)를 쓴다.

## 공통 계약
- 계약은 `packages/core/src/canvas.ts`에 있다(순수 함수 + `test/canvas.test.ts`).
- 동기화:
  - `page.new.pageKind: 'canvas'`는 기능 `'canvas'`가 필요하다. 옛 PC에는 outdated로 처리한다.
  - `page.edit`의 상한은 `SYNC_LIMITS.doc`(8M)이다.

## 소유권
- 리더:
  - core 전체.
  - ui 연결부: ChatPanel, EmptyChat, SessionMenu, Sidebar, MindmapView, SessionHeader, SearchPalette, app/sync.
  - 문서.
- canvas-ui 에이전트: `packages/ui/src/canvas/*`, `e2e/canvas.spec.ts`, ui 의존성(perfect-freehand).
- 리뷰어: 별도 에이전트가 diff를 읽기 전용으로 검토한다.

## 난이도·모델
- core 계약과 연결부는 MEDIUM이다. 현재 모델(Opus 5.5)이 직접 맡는다.
- 캔버스 보드(포인터·확대·손바닥 무시)는 HIGH다. 현재 모델을 상속한 general-purpose 에이전트가 맡는다.

## 검증
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(canvas spec 포함).
- 데스크톱 앱을 패키지로 만들고 실행한다. 데스크톱·모바일 폭 스크린샷도 남긴다.
