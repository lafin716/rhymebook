# 페이지 편집기 — 행 상대 핸들 · 열 중첩 편집기 · Tab (ADR-096)

난이도: HIGH (CodeMirror 구조 변경). 실행: 현재 모델(Opus 5.5) 직접 수행 — 같은 파일(livePreview/PageEditor/PageBlockHandles) 집중이라 병렬 이익 없음.

## 목표 / 완료 기준
1. 열 묶음은 항상 칸 상자로 보이고(`---`·표시 줄 노출 없음) 각 칸은 자기 편집기로 그 칸만 고친다. 칸마다 +·핸들(메뉴: 왼쪽/오른쪽으로, 묶음에서 빼기, 칸 지우기).
2. 칸 안의 표·코드·수식·제목·목록이 본문과 같게 렌더링된다(칸 편집기가 같은 livePreview 사용).
3. 블록 핸들·+는 각 블록 시작의 높이 0 블록 위젯 안에 절대 배치 — 문서 좌표 계산 없이 행 왼쪽 위에 붙는다.
4. Tab: 목록 줄은 하위 목록으로 들여쓰기, Shift+Tab 내어쓰기. 그 외 커서 자리에 공백 4칸.

## 유지
- data-page-row-add / data-page-handle / data-block-kind / data-active, 끌어 옮기기(슬롯·나란히), 모바일 행 선택·시트, 블록 메뉴.

## 계약
- 칸 편집 → 본문 반영 userEvent `input.column` (protectColumnMarks 예외). 칸 구간 = 칸 시작 표시 줄 다음 ~ 다음 표시 줄 앞.
- core: `reorderColumn`, `moveColumnOut`, `removeColumn` + Vitest.

## 검증
pnpm typecheck && pnpm lint && pnpm test, pnpm e2e(칸 편집·Tab·핸들 정렬), 데스크탑 앱 빌드·실행.

## 결과 (2026-10-30)
DONE — 1~4 구현. typecheck/lint/unit PASS, e2e 186 passed(기존 skill-sync-split 2 실패만). 칸 끌어 옮기기는 메뉴로 대신함(ADR-096).
