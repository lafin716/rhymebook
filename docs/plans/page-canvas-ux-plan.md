# 마크다운 페이지 · 캔버스 UX 묶음 (IMP-30, ADR-087~089)

모드: Project Orchestration (페이지 10건 + 캔버스 6건, 4개 독립 영역). 리더가 PROGRESS·이 계획·공유 계약(`chat/pageEditorBridge.ts`)을 소유한다.

## 목표 · 완료 기준
### 마크다운 페이지 (ADR-087)
| # | 요구 | 관찰 가능한 완료 기준 |
|---|---|---|
| P1 | AI 정리 후 되돌리기 버튼 숨김 | 정리 끝나도 헤더에 `[data-page-ai-undo]` 없음. 되돌리기는 편집기 실행 취소(⌘Z·Undo 버튼)로 — 정리 결과를 편집기 기록 한 칸으로 넣는다 |
| P2 | 상단 좌측 Undo/Redo | 페이지 본문 위 도구 줄 좌측 `[data-page-undo]`·`[data-page-redo]`, 기록 없으면 비활성 |
| P3 | `:` 이모지 미리보기 | `:smi` 입력 → 후보 목록(이모지+이름), ↑↓/Enter/Tab/클릭으로 넣기, Esc 닫기. 한글 조합 중 Enter 무시 |
| P4 | 모바일 앱 키보드 위 단축키 바 | `caps.kind==='mobile'`에서 편집기 포커스 + 키보드 열림 시 visualViewport 하단에 바: 내어쓰기·들여쓰기·목록·번호·할 일·제목·굵게·실행 취소·다시 실행·키보드 닫기. 설정에서 끄면 안 보임 |
| P5 | 상단 우측 설정 버튼 | 도구 줄 우측 `[data-page-settings-open]` → 페이지 설정 창: 키보드 단축키 바(모바일 앱) 켜기/끄기, 이모지 미리보기 켜기/끄기 (기기별 localStorage `octobooks.page.*`) |
| P6 | 이미지 클릭 선택·통째 삭제 | 미리보기 이미지 클릭 → 선택 테두리(`[data-page-image-selected]`), Backspace/Delete 한 번에 `![…](…)` 전체가 지워짐(되돌리기 한 칸) |
| P7 | 행마다 핸들로 위치 조정 | 각 블록(문단·제목·목록 항목·코드·표·이미지·인용·나란히 묶음) 왼쪽에 hover(데스크톱)/항상(터치) 핸들 `[data-page-handle]`, 끌어 위아래 순서 변경 |
| P8 | 핸들로 좌우 그리드 | 다른 블록의 좌/우 가장자리에 놓으면 나란히(2~3칸) 배치, 칸 밖으로 끌면 풀림 |
| P9 | 번호 목록 자동 번호 | 중간 항목을 지우면(또는 순서 바꾸면) 아래 번호가 당겨짐. 사용자 입력 1회 = 되돌리기 1칸 |
| P10 | 선택 팝업 하나로 | 모바일에서 글 선택 시 시스템 메뉴 안 뜸(페이지 편집기 안 선택), 블록·AI 메뉴(Ctx)가 선택 메뉴와 동시에 뜨지 않음. 선택 메뉴에 'AI로 채우기' 추가 → 편집기 채우기 입력 창 |

### 캔버스 (ADR-088·089)
| # | 요구 | 완료 기준 |
|---|---|---|
| C1 | 전체 화면 버튼을 도구 막대의 가져오기 왼쪽으로, 전체 화면이면 제목줄 숨김 | 헤더 `PanelFullToggle` 대신 도구 막대 `[data-panel-full]`. `panelFull`이면 캔버스 SessionHeader 렌더 안 함 |
| C2 | 맞춤 상태에서 한 축만 스와이프 | 쪽 나눔(가로형·세로형·A4·PDF) + 맞춤 배율(≤ fit×ZOOMED_IN)일 때 끌기·휠 이동이 흐름 축(가로 흐름=x, 세로 흐름=y)만. 확대하면 자유 |
| C3 | 색 팔레트 개수 설정 + 접기 | 설정 창 '한 번에 보일 색 개수'(1~기본+즐겨찾기 수), 도구 막대에 접기/펼치기 토글(접으면 현재 색 하나만). 기기별 저장 |
| C4 | 도구 막대 핸들로 동서남북 | 막대 맨 앞 핸들 `[data-canvas-dock-handle]` 끌어 놓으면 가장 가까운 가장자리(N/E/S/W)에 붙음. E/W는 세로 막대. 기기별 저장 |
| C5 | 전체 화면 왼쪽에 발표 버튼 | `[data-canvas-present]` |
| C6 | 발표 모드 | 화면 전체(Fullscreen API), 발표 도구 막대: 레이저 포인터·펜·지우개·색·쪽 넘김·발표 화면 열기·끝내기. 발표 필기는 임시(저장 안 함, 끝내면 사라짐). '발표 화면 열기' → 청중 창(도구 막대 없음)이 같은 쪽·필기·포인터를 실시간으로 보임. 데스크톱은 외부 디스플레이가 있으면 그 화면에 전체 화면으로 연다 |

## 유지할 동작
- 저장 형식은 순수 마크다운. 나란히 배치는 HTML 주석 마커라 다른 마크다운 뷰어에서는 순서대로 보인다.
- 페이지: ADR-086 실시간 저장·외부 변경 반영·가지/서식 표시·`/` 메뉴·우클릭 메뉴(데스크톱)·AI 채우기 그대로.
- 캔버스: 쪽 넘김 스와이프(settle), 펜/손바닥 거부, 핀치 확대, 기존 prefs 키.

## 공유 계약
1. `chat/pageEditorBridge.ts` (리더 작성 완료): `PageEditorApi { format(kind); openFill() }`, `registerPageEditor(view, api)`, `formatPage`, `openPageFill(view)`, `canFillPage(view)`.
2. `PageEditor` 새 props (A1 구현, A2 사용):
   - `onView?: (view: EditorView | null) => void` — 만들 때/없앨 때 알림
   - `onHistory?: (h: { undo: number; redo: number }) => void` — 문서·기록이 바뀔 때 `undoDepth/redoDepth`
   - `emoji?: boolean` (기본 true) — `:` 미리보기 켜기
   - `seal?: (text: string) => void` 는 만들지 않는다. 대신 AI 정리 결과는 PagePanel이 `view.dispatch`로 넣는다(아래 4).
3. 나란히 마크다운 (core `pageColumns.ts`, A1):
   ```
   <!-- columns -->
   왼쪽 블록들
   <!-- column -->
   오른쪽 블록들
   <!-- /columns -->
   ```
   core 순수 함수: `markdownBlocks(text) → {from,to,kind}[]`(최상위 블록, columns 묶음은 한 블록), `moveMarkdownBlock(text, index, toIndex)`, `placeBlockBeside(text, index, target, side:'left'|'right')`, `unwrapColumn(...)`, `renumberOrderedLists(text) → text`, `emojiMatches(query, limit)`. Vitest 필수.
4. AI 정리 되돌리기 (A2): PagePanel `organize()` 결과를 저장 경로 그대로 쓰되, 열린 편집기가 있으면 `view.dispatch({changes: 전체 교체, userEvent:'input.ai'})`로 넣어 편집기 기록 1칸이 된다. `undo` 상태·되돌리기 버튼 제거.
5. 캔버스 prefs (C, `canvasPrefs.ts`): `loadPaletteCount/save…`(기본 = 기본 색 7 + 즐겨찾기), `loadPaletteOpen/save…`(기본 true), `loadToolbarDock/save…`(`'top'|'right'|'bottom'|'left'`, 기본 top).
6. CanvasBoard 새 props (D 구현, C가 CanvasPanel에서 전달):
   - `panAxis?: 'x' | 'y' | null` — 한 손가락/마우스 끌기 이동과 휠 이동을 이 축으로만
   - `pointer?: boolean` — 레이저 포인터 도구(그리지 않고 `onPointer(world|null)`) — 발표 전용, `onPointer?: (p: {x:number;y:number} | null) => void`
   - `laser?: {x:number;y:number} | null` — 포인터 점 그리기
   - `tool`에 'pointer' 추가 대신 위 `pointer` 플래그로 처리(기존 `CanvasToolId` 불변).
7. 발표 (D): `canvas/CanvasPresentation.tsx` `export function CanvasPresentation(p: { sessionId: ID; doc: CanvasDoc; page: number; onExit(): void })` — `fixed inset-0 z-[60]` 자체 렌더. CanvasPanel(C)이 `presenting` 상태로 렌더하고 도구 막대 `onPresent`에서 켠다.
   청중 창: `?window=present&session=<id>` → `main.tsx`가 `PresentAudienceApp`(D, `canvas/PresentAudience.tsx`)을 렌더. 동기화는 `canvas/presentChannel.ts`(D): BroadcastChannel `octobooks-present:<sessionId>` 메시지 `{type:'state', doc, page, laser}` / `{type:'hello'}` / `{type:'end'}`. 데스크톱은 preload `desktop.window.openPresent(sessionId)` → main이 외부 디스플레이(없으면 주 화면) 전체 화면 창. 웹은 `window.open`.


## Critic 검토 반영 (계약 보강 — 구현자는 이 절이 위 내용보다 우선)
1. **AI 정리 되돌리기**: 열린 편집기(view)가 있으면 organize()는 `view.dispatch({changes: minimalChange(before,next), userEvent:'input.ai'})`만 하고 updatePage를 부르지 않는다(updateListener→onChange가 저장). view가 없을 때만 updatePage. `minimalChange`는 A1이 `chat/pageText.ts`(신규)로 export, A2가 import. 잠금(readOnly)은 dispatch를 막지 않는다.
2. **브리지 확장(리더 완료)**: `PageEditorApi { format, canFill, openFill, block(kind:'h1'|'h2'|'h3'|'bullet'|'ordered'|'todo'), indent(1|-1) }` + `canFillPage`·`openPageFill`·`pageBlock`·`indentPage`. A1 구현, A2 키보드 바·선택 메뉴가 호출. `canFill`은 onFill 있고 안 잠김일 때만 true.
3. **팝업 하나로**: 터치(`caps.kind==='mobile'` 또는 직전 pointerType≠mouse)에서는 PageEditor가 contextmenu로 Ctx를 열지 않는다(블록 메뉴는 핸들 탭으로). Ctx는 `[data-page-ctx]`로 렌더, SelectionMenu는 그 요소가 있으면 숨는다. 선택 메뉴에 'AI로 채우기'(canFillPage일 때)·복사·잘라내기(페이지 편집기 선택일 때).
4. **모바일 시스템 메뉴**: A1이 contentAttributes에 `data-page-editor` 추가. textMenu.ts는 선택이 비어 있지 않고 그 안이면 억제, 접힌 커서는 시스템 메뉴 유지(붙여넣기). 첫 길게 누름 깜빡임은 BLOCKERS에 기록.
5. **나란히(P8)**: columns 묶음은 커서 밖일 때 livePreview StateField에서 묶음 전체를 `block:true` 위젯 하나로 바꿔 CSS grid로 읽기 렌더, 클릭하면 원문(표 위젯과 같은 방식). 위젯 안 각 칸 블록도 핸들로 칸 밖으로 끌어낼 수 있으면 좋고, 최소한 묶음 핸들 메뉴 '나란히 풀기'. AI 정리 프롬프트는 바꾸지 않는다(정리 시 묶음이 풀릴 수 있음 — 알려진 한계).
6. **번호(P9)·이미지 삭제(P6)**: transactionFilter로 같은 트랜잭션에 덧붙여 되돌리기 1칸. `external` 주석·사용자 이벤트 아닌 트랜잭션은 건너뜀. 블록 이동은 minimalChange + `userEvent:'move.block'` 1회.
7. **PanelFullToggle**: 기존 export·무인자 기본 동작 유지(PagePanel이 계속 씀). C는 선택 prop만 추가. e2e 선택자는 `[data-canvas-toolbar] [data-panel-full]`처럼 범위 지정. 전체 화면에서 Esc로 해제.
8. **CanvasBoard**: `readOnly?: boolean` 추가(포인터 처리 없음, 청중 창). 발표는 자체 `ink` 상태 + 로컬 view로 `doc={...doc, items:[...doc.items, ...ink]}`, onCommit은 로컬만. 쪽 사각형은 core `canvasPageRects` 등으로 D가 직접 계산. C는 CanvasPanel 창 keydown(실행 취소·삭제)을 `!presenting`으로 막는다. `panAxis`는 핀치·ctrl+휠 확대를 막지 않는다.
9. **발표 채널 메시지**: `{type:'doc', doc}`(hello 응답·문서 바뀔 때만), `{type:'page', page}`, `{type:'ink', items}`(획 끝날 때), `{type:'laser', p}`(rAF 스로틀), `{type:'hello'}`, `{type:'end'}`. 전송 계층 추상화: 웹 BroadcastChannel, 데스크톱 패키지(file://)는 main IPC 중계(`present:send`→모든 present 창·발표자 창 `present:recv`). 발표 창은 createWindow를 쓰지 않는 전용 창(외부 디스플레이 bounds + setFullScreen), 세션 창 맵·SyncHost 등록 안 함.
10. **iOS 전체 화면**: `fixed inset-0`가 진짜 전체 화면, `requestFullscreen?.()`는 실패 무시, `fullscreenchange`로 빠져도 발표는 유지(끝내기는 버튼·Esc 두 번 아님 — Esc는 전체 화면 해제가 먼저 먹으므로 오버레이에서 Esc 한 번 = 끝내기, 단 fullscreen 해제 직후는 무시).
11. **키보드 감지(P4)**: 편집기 포커스 + (`innerHeight`가 기록된 최댓값보다 120px 이상 작음 — Android) 또는 (`visualViewport.height < innerHeight - 120` — iOS). 위치 `visualViewport.offsetTop + height` 바로 위. '키보드 닫기' = `contentDOM.blur()`.
12. **도킹 E/W**: 세로 막대의 팝오버는 옆으로 연다.

## 소유권 (동시 작성자 1명)
| 에이전트 | 파일 |
|---|---|
| A1 페이지 편집 엔진 | `packages/core/src/pageColumns.ts`(+test), `packages/core/src/emoji.ts`(+test), core `index.ts` export 추가, `packages/ui/src/chat/PageEditor.tsx`, `packages/ui/src/chat/livePreview.ts`, 새 `chat/pageHandles.ts`·`chat/pageEmoji.ts`·`chat/pageText.ts` 등 chat/page* 신규 파일 (pageEditorBridge.ts·pagePrefs.ts·PageKeyboardBar·PageSettings 제외) |
| A2 페이지 화면 | `chat/PagePanel.tsx`, `chat/SelectionMenu.tsx`, 새 `chat/PageKeyboardBar.tsx`·`chat/PageSettings.tsx`·`chat/pagePrefs.ts`, `apps/mobile/src/textMenu.ts`, `e2e/page-*.spec.ts` 신규 |
| C 캔버스 도구 막대 | `canvas/CanvasToolbar.tsx`, `canvas/canvasPrefs.ts`, `canvas/CanvasSettings.tsx`, `canvas/CanvasPanel.tsx`, `components/PanelFullToggle.tsx`, `e2e/canvas-toolbar.spec.ts` 신규 |
| D 캔버스 보드·발표 | `canvas/CanvasBoard.tsx`, 새 `canvas/CanvasPresentation.tsx`·`canvas/PresentAudience.tsx`·`canvas/presentChannel.ts`, `packages/ui/src/main.tsx`, `app/runtime.ts`(present 창 판별·desktop 타입), `apps/desktop/src/main.ts`·`preload.ts`·`ipc.ts`, `e2e/canvas-present.spec.ts` 신규 |
| 리더 | PROGRESS·DECISIONS·BLOCKERS·이 계획·pageEditorBridge.ts·통합·버전 |

## Task Graph
| ID | Task | Owner | 난이도 | 모델 | 의존 |
|---|---|---|---|---|---|
| T0 | 계약·계획·critic 검토 | lead | MEDIUM | inherit(opus) | - |
| T1 | 페이지 엔진(P3,P6,P7,P8,P9 + onView/onHistory/openFill/터치 Ctx 억제) | A1 | HIGH | inherit(opus) | T0 |
| T2 | 페이지 화면(P1,P2,P4,P5,P10) | A2 | MEDIUM | inherit(opus) | T0 (T1 props는 계약대로, 통합 시 확인) |
| T3 | 캔버스 도구 막대(C1,C3,C4,C5 버튼, CanvasPanel 연결) | C | MEDIUM | inherit(opus) | T0 |
| T4 | 캔버스 보드 축 잠금·발표(C2,C6) | D | HIGH | inherit(opus) | T0 |
| T5 | 통합·typecheck/lint/test/e2e | lead | MEDIUM | inherit | T1~T4 |
| T6 | 독립 리뷰 → 반영 | reviewer(별도) + lead | MEDIUM | inherit | T5 |
| T7 | 스크린샷 390/768/1440, 데스크톱 패키지 앱 실행, ADR·PROGRESS·커밋·버전 | lead | LOW | inherit | T6 |

모델: Claude Code는 서브에이전트 모델 선택이 가능하지만 HIGH/MEDIUM 모두 정확성이 중요한 UI·에디터 작업이라 현재 모델(opus)을 상속한다.

## 검증
`pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(새 spec 포함), 스크린샷 390·768·1440, `pnpm --filter @branch/desktop package:dir` 후 앱 실행.

## 알려진 한계 (계획 단계)
- iOS/Android 앱의 외부 디스플레이는 OS 미러링이라 청중 화면만 도구 막대를 숨기려면 네이티브 외부 화면 장면(UIScene/Presentation)이 필요 → BLOCKERS에 기록, 앱에서는 '발표 화면 열기'를 숨긴다.
