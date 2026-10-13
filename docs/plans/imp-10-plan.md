# IMP-10 계획 — 가지 삭제·별도 창 팝업·수식·분할창 이동/스왑

## 목표 (관찰 가능한 완료 기준)
1. 사이드바 가지(BranchRow) 우클릭 메뉴에 **삭제**(확인 후, 하위 가지 포함) — 루트와 동일 동작.
2. 사이드바(루트·가지) 우클릭 메뉴에 **새 창으로 열기** — 데스크톱 앱에서 별도 BrowserWindow로 그 세션을 연다. 메인에 떠 있어도, 이미 같은 창이 있어도 새로 연다(중복 허용).
3. 답변 마크다운의 수식: `$$…$$`(블록), `$…$`(인라인) KaTeX 렌더. 가지 앵커·서식 하이라이트가 깨지지 않는다.
4. 분할창 헤더(타이틀 옆)에 이동 아이콘 → 왼/오/위/아래 이웃과 자리 바꾸기.
5. 분할 경계선 가운데 ⋯ 버튼 → 작은 플로팅 팝업에서 경계 양쪽 창 **스왑**(갤럭시 탭 화면 분할 참고), 방향 전환(좌우↔상하) 포함.

## 설계
- (2) 새 창 = 메인 창(동기화 엔진)의 **로컬 SyncClient** (ADR-036). main 프로세스가 `win-<id>` peer로
  엔진 창 SyncHost와 IPC 중계. 팝업 창은 저장소를 갖지 않고 미러링 → 두 창 상태가 항상 일치, CLI 실행은 엔진 창.
  URL `?window=session&id=<sessionId>` → `remoteMode`(로컬 창) + 단일 ChatPanel 전용 셸.
- (3) remark-math + rehype-katex. anchorPlugin은 `.katex-mathml` 숨김 텍스트를 세그먼트 맵에서 제외.
- (4)(5) core `splitLayout`에 순수 함수 `swapLeaves`, `neighborOf`, `flipGroupDir` + Vitest, 스토어 액션 `swapSplit`.

## 소유권 / 실행
| 묶음 | 담당 | 파일 | 난이도 |
|---|---|---|---|
| A 분할 이동·스왑(4,5) | 서브에이전트 | core/splitLayout.ts(+test), core/store/index.ts(액션 추가), ui/views/SplitView.tsx, ui/views/새 파일 | MEDIUM |
| B 수식(3) | 서브에이전트 | ui/chat/Markdown.tsx, ui/chat/anchorPlugin.ts, ui/package.json, pnpm-lock.yaml | MEDIUM |
| C 삭제·새 창(1,2) | 리더 | ui/session/*, apps/desktop/src/*, core/platform.ts, ui/app/{capabilities,sync,runtime}.ts, ui/main.tsx, ui/window/* | HIGH |

모델: 현재 Claude 모델 상속(Opus 5.5), 별도 effort 지정 없음.
기존 미커밋 변경(스킬 보조: core providers·skillAssist, ui store/Composer/Skills)은 건드리지 않고 커밋에서 제외한다.

## 검증
`pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`, Windows `package:dir` 빌드 후 실제 앱 조작(새 창·삭제·수식·스왑).
