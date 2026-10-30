# 페이지 편집기 개편 계획 (ADR-095)

모드: Scoped feature (한 컴포넌트군 — packages/ui/src/chat 페이지 편집기 + core 순수 함수). 난이도 HIGH(CodeMirror 입력·장식·터치 상호작용이 얽힘).
모델: 리더 = 현재 세션 모델(Opus 5.5) 직접 구현. 같은 파일(PageEditor.tsx)을 여러 요구가 동시에 고쳐 병렬 구현 이익이 작다 → 순차 구현.
계획 리뷰·코드 리뷰는 별도 에이전트(구현자와 분리).

## 유지할 것
- 원문 마크다운이 진실 원천(앵커 오프셋 `locateSourceAnchor`), 저장 500ms 디바운스·blur 저장.
- 인라인 서식(`**`, `*`, `~~`, `` ` ``, 링크)은 지금처럼 커서가 닿으면 원문을 드러낸다.
- 슬래시 메뉴, 이모지, AI 채우기, 칸 묶음(columns), 이미지, 표, 수식, 번호 다시 매기기, 기록(undo) 동작.
- 데스크톱 핸들 끌기(위아래·좌우 나란히) — 위치만 바뀐다.

## 요구 → 설계

### R5 스페이스로 블록 변환 · 변환된 기호는 편집 중에도 숨김
- 렌더 규칙(livePreview `build`): 줄 머리 기호는 **뒤에 공백이 있을 때만** 블록으로 본다.
  - `#`만 있는 줄, `-`·`1.`·`>`만 있는 줄 → 평범한 글(장식 없음). `# `(공백) → 제목.
  - 변환된 블록의 머리 기호(`#… `, `> `, 할 일의 `- `)는 커서가 그 줄에 있어도 숨긴다(lineTouched 조건 제거). 글머리 `-`는 늘 점 위젯, 할 일 `[ ]`는 늘 체크박스, 번호 `1.`은 숫자로 보인다(내용이므로).
  - Setext 제목(`글\n---`)은 제목으로 그리지 않는다 — `---`를 치는 순간 윗줄이 커지는 실시간 변환을 없앤다.
- 커서 보정(transactionFilter): 빈 커서가 숨긴 머리 기호 안(줄 시작~내용 시작)에 놓이면 내용 시작으로 옮긴다(Home·클릭·화살표). 범위 선택은 그대로.
- 키:
  - Backspace: 내용 시작에서 누르면 기호를 지워 평범한 줄로 되돌린다(들여쓴 목록은 내어쓰기 먼저). Notion 방식.
  - Enter: 내용이 있는 제목·인용 줄의 내용 시작에서 누르면 위에 빈 줄을 넣는다(제목이 깨지지 않게). 목록은 기존 이어쓰기.
  - Space: `[]` 뒤 공백 → `- [ ] `(할 일 지름길). 나머지는 공백이 들어가며 자연히 변환된다.
- core 순수 함수(`packages/core/src/pageRows.ts`, Vitest):
  - `rowPrefix(line)` → `{ kind, indent, end, level? } | null` — 공백까지 포함한 머리 기호 끝(내용 시작). 제목/인용/글머리/번호/할 일. 공백 없는 기호는 null.
  - `spaceShortcut(beforeCursor)` → 바꿀 글 | null (`[]`→`- [ ] `).

### R1·R2·R3 행 앞 + · 핸들
- PageBlockHandles: 커서가 있는 블록(편집 중) + 데스크톱 호버 블록에 `+`(data-page-row-add)와 핸들(data-page-handle)을 나란히 보인다. 빈 줄은 블록이 아니므로 버튼이 없다("텍스트 입력 후").
- `+`: core `insertRowAfter(text, index)` → `{ text, cursor }`. 목록·할 일·번호는 같은 기호로 새 항목(번호는 다음 수), 인용·표·코드·수식·칸 묶음 뒤는 빈 줄 하나 띄우고 새 줄(문법이 이어 붙지 않게), 나머지는 바로 아래 빈 줄. 포커스·커서 이동, userEvent `input.row`.
- 핸들: 데스크톱 끌기 이동·누르면 블록 메뉴(기존). 모바일은 핸들을 바로 끌어 옮긴다(길게 누르기 들기 제거 → 길게 누르기는 OS 글 선택에 양보).
- 왼쪽 여백: 데스크톱 `pl-12`(두 버튼), 모바일 `pl-11`.

### R4 모바일: 한 번 탭 = 행 선택, 다시 탭 = 편집
- 모바일(터치 포인터, `touchBlocks`)에서 편집 중이 아니면 편집기를 보기 모드(StateField `viewModeField` + `setViewMode` 효과 → `EditorView.editable` false)로 둔다 → 탭해도 키보드가 뜨지 않는다. 길게 눌러 글 선택(읽기 선택 메뉴)은 그대로 된다.
- 탭(pointerType touch, 8px 이내, 500ms 이내) → posAtCoords로 블록을 찾아 "선택된 행"(state)으로 표시(`data-page-row-selected` 강조) + 행 앞 +/핸들 + 하단 블록 액션 시트.
- 선택된 같은 행을 다시 탭 → editable 켜고 탭 위치에 커서, `view.focus()`(사용자 제스처 안이라 키보드가 뜬다). 다른 행 탭 → 그 행 선택. 바깥 탭/스크롤 → 선택 해제.
- 편집 중 blur → 다시 보기 상태(editable false). 체크박스·이미지·링크 위젯 탭은 그대로 동작.
- 마우스(데스크톱·e2e click)는 지금처럼 바로 편집.

### R7 모바일 메뉴 UX
- 우클릭 메뉴 → **블록 액션 시트**(`PageRowSheet.tsx`)(하단 고정, `data-page-sheet`): 선택된 행 또는 핸들 탭으로 연다. 내용: [편집] [아래에 행 추가] [위로] [아래로] / 블록 바꾸기 칩(본문·제목1~3·글머리·번호·할 일·인용) / [AI로 이어 쓰기](가능할 때) / [칸 풀기](columns) / [삭제]. 큰 터치 영역(44px), 한국어 라벨, 바깥 탭·Esc로 닫힘.
- 데스크톱 우클릭·핸들 클릭은 기존 떠 있는 메뉴(data-page-ctx) 유지.
- 드래그(글 선택) 메뉴 → 기존 전역 SelectionMenu 모바일 하단 바 유지하되, 키보드가 열려 있으면 visualViewport 기준으로 키보드 위에 붙인다(키보드 바와 겹치면 그 위). 키보드 바(PageKeyboardBar)는 글을 고른 동안 숨긴다.
- 블록 바꾸기는 bridge `block(kind)`를 확장(`paragraph`, `quote` 추가)해 시트와 키보드 바가 함께 쓴다.

### R6 되돌리기·설정 → 제목 바
- PagePanel의 본문 위 도구 줄 제거. SessionHeader `actions`에 [실행 취소][다시 실행][설정](아이콘, data 속성 유지) + 기존 AI 정리·전체화면.
- 모바일 compact에서도 아이콘만(size sm).

## 소유권(순차)
1. core `pageRows.ts` + 테스트 + index export
2. livePreview.ts (R5 렌더)
3. PageEditor.tsx (R5 키·커서 보정, R4 탭 상태, R7 시트, bridge 확장)
4. PageBlockHandles.tsx (R1~R3, 모바일 핸들 끌기)
5. PagePanel.tsx (R6), SelectionMenu/PageKeyboardBar(R7 키보드 위치)
6. styles.css, e2e 갱신·추가
7. 문서: DECISIONS ADR-095, PROGRESS

## 검증
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(desktop·mobile 프로젝트).
- e2e 추가: `#` 입력 시 평문 → 공백 후 제목·기호 숨김 / Backspace로 되돌림 / + 버튼으로 아래 행 / 모바일 tap 두 번으로 편집·시트 동작 / 제목 바 되돌리기·설정.
- 데스크톱 앱 재빌드·실행, 웹 1440/768/390 스크린샷.

## 위험
- 숨긴 기호 안 커서 → 커서 보정 필터로 막음. IME(한글) 조합 중 Space: inputHandler가 아니라 문서 변화 후 판단(spaceShortcut은 트랜잭션 필터로 `input.type` 공백 삽입 감지).
- editable false 상태에서 CM 위젯 클릭 핸들러(체크박스)가 막히지 않는지 확인.

## 구현 결과 (2026-10-30)
- 계획과 다른 점: Compartment 대신 StateField 보기 모드, 모바일 길게 눌러 들기(ADR-091) 제거 → 행 선택 + 핸들 터치 끌기 + 시트.
- 행 편집 확장: `packages/ui/src/chat/pageRowEditing.ts`(커서 보정·Backspace/Enter·입력 규칙·`insertRowBelow`·`selectedRowField`·`setRowKind`).
- SelectionMenu 모바일 바: `visualViewport`로 키보드 높이를 재 키보드 바로 위에 붙인다.
- 의도적으로 하지 않음: 빈 줄 Backspace 특수 규칙(기본 동작으로 충분).
- 검증: typecheck·lint·unit PASS, e2e 새/갱신 spec PASS, 전체 e2e 실패 3건은 기존(skill-sync-split)·간헐(annotations).
