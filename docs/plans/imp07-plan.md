# IMP-07 · 백그라운드 호스트(트레이) · 여러 줄 가지 영역 표시 · 드래그 메뉴 서식·메모

## 목표
1. **백그라운드 서버화**: 데스크톱에서 원격 페어링(호스트)이 켜져 있으면 창을 닫아도 앱이 트레이에 남아 페어링된 기기가 계속 보고 질문할 수 있다. 트레이 메뉴로 열기/완전 종료.
2. **여러 줄 가지 = 왼쪽 영역 표시**: 여러 블록(문단·목록 항목 등)에 걸친 가지는 부모 답변에서 본문 전체 배경 하이라이트 대신 왼쪽 여백의 세로 막대(영역)로 표시.
3. **드래그 메뉴 메모**: 선택 텍스트에 메모를 달고, 본문에 표시·클릭해 보기/수정/삭제.
4. **드래그 메뉴 서식**: 형광펜·밑줄·글자색(색상 선택)·글꼴(명조/고정폭)·굵게·기울임, 서식 지우기.

## 완료 기준 (관찰 가능)
1. 호스트 켜짐 + 창 닫기(⌘W/빨간 버튼/Windows X) → 창은 사라지고 트레이 아이콘이 남는다. 페어링된 웹에서 세션 목록·질문이 계속 동작. 트레이 [열기]로 창 복원, [완전 종료]로 프로세스 종료(웹은 오프라인). 호스트 꺼짐이면 기존 동작.
2. 두 문단에 걸쳐 선택한 가지 → 해당 범위 텍스트에 배경 없음, 왼쪽에 세로 막대. 막대 hover 시 범위 강조, 클릭 시 가지 열림. 한 문단 안 가지는 기존 인라인 하이라이트.
3. 텍스트 선택 → 메뉴 [메모] → 입력 → 저장 → 본문에 메모 표시(점선 밑줄+아이콘). 클릭 → 팝오버에서 메모 보기·수정·삭제. 새로고침 후 유지.
4. 선택 → 형광펜 색 선택 → 즉시 적용. 밑줄/글자색/글꼴/굵게/기울임 동일. [서식 지우기] → 선택과 겹치는 서식 삭제. 가지 하이라이트와 겹쳐도 offset이 깨지지 않는다(이후 가지 생성 정상).
5. 원격(웹·모바일)에서 만든 서식·메모가 PC에 저장되고, PC 변경이 원격에 실시간 반영.
6. `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e` 통과. 390/768/1440 스크린샷. 데스크톱 `package:dir` 빌드·실행.

## 유지할 동작
- 앵커 offset 규칙(렌더 텍스트 = DOM textContent). 서식/메모 표시가 DOM 텍스트를 추가하면 안 된다(아이콘은 CSS pseudo-content).
- 기존 가지 메뉴(이게 뭐야?/더 자세히/직접 질문)와 키보드·모바일 바텀 바 동작.
- 호스트 꺼짐 시 창 닫기 동작, macOS ⌘Q 완전 종료.
- 원격 클라이언트는 store가 repo에 쓰지 않음(ADR-026). sync 엄격 검증.
- 작업 트리의 다른 사람 변경(사이드바 접기: App.tsx, uiState.ts, TopBar.tsx, Sidebar.tsx)은 보존하고 이번 커밋에 섞지 않는다.

## 공통 계약 (리더 작성)
### 모델 — `packages/core/src/model.ts` (작성 완료)
`MarkColor`, `MarkFont`, `AnnotationStyle`, `Annotation {id, sessionId, anchor, ...style, note?, createdAt, updatedAt}`, `AnnotationPatch`(null = 지움), `MAX_NOTE_LENGTH`.

### 스토어 — `packages/core/src/store/index.ts`
- `AppData.annotations: Record<ID, Annotation>` (load/applyRemote/persist 포함, 기본 `{}`)
- `addAnnotation(sessionId: ID, anchor: Anchor, init: AnnotationStyle & { note?: string }, id?: ID): ID`
- `updateAnnotation(id: ID, patch: AnnotationPatch): void` — 결과가 서식·메모 모두 없으면 삭제
- `deleteAnnotations(ids: ID[]): void`
- 세션 삭제 시 그 세션들의 annotation 함께 삭제
- 순수 함수(core export): `annotationsForMessage(annotations, messageId): Annotation[]`(startOffset 순), `isEmptyAnnotation(a)`, `findAnnotationsOverlapping(annotations, messageId, start, end)`
### Repository — `packages/core/src/repo.ts`
`saveAnnotation(a)`, `deleteAnnotations(ids)`; memoryRepository·gatedRepository 반영. Dexie `version(3)` `annotations: 'id, sessionId'`, hydrate 로드. 백업 스냅샷 `annotations?` (없으면 빈 배열, 이전 백업 호환).
### Sync — `packages/core/src/bridge/sync.ts`
- op: `{kind:'annot.set'; annotation: Annotation}` (upsert), `{kind:'annot.delete'; ids: ID[]}` — 검증: id 정규식, anchor offset 정수·범위, 색/글꼴 열거값, note ≤ MAX_NOTE_LENGTH, ids ≤ SYNC_LIMITS.
- server: `sync.snapshot`에 `annotations: Annotation[]`(선택 필드, 없으면 빈 배열), `{type:'sync.annot'; annotation}` | `{type:'sync.annot'; deleted: ID[]}`.
- host: annot op 적용 + annotations 변경을 모든 피어에 push. client: add/update/delete 낙관적 적용 후 op 전송, push 반영.
### UI 표시 계약
- `rehypeAnchors` 확장: 가지 앵커 + annotation 범위를 함께 잘라 `span.annot[data-annot-ids][data-hl][data-ul][data-tc][data-font][data-bold][data-italic][data-note]` 안에 `mark.anchor`. 메모 끝 표시는 빈 요소 + CSS `::after`.
- 영역 모드: 앵커가 2개 이상 블록에 걸치면 그 조각 mark에 `data-region`(배경 없음). 메시지 컨테이너 왼쪽 gutter에 막대(`.anchor-region`), 겹치면 lane. 측정은 layout effect + ResizeObserver.

## Task Graph / 소유권
| ID | 내용 | 소유(쓰기) | 의존 | 난이도 |
|---|---|---|---|---|
| T0 | 계획·ADR-028/029/030·PROGRESS·모델 계약 | lead | - | HIGH |
| T1 | core: annotation 스토어·repo·백업·sync(host/client/검증)·테스트 + ui persist(Dexie v3·hydrate) | agent-core (`packages/core/**`, `packages/ui/src/persist/**`) | T0 | HIGH |
| T2 | UI: rehype 서식/메모 렌더, 영역 막대, 드래그 메뉴 서식·메모 행(데스크톱/모바일), 메모·서식 팝오버, CSS | agent-ui (`packages/ui/src/chat/**`, `packages/ui/src/styles.css`, 새 컴포넌트) | T0 (T1 API 계약) | HIGH |
| T3 | desktop: 트레이·창 닫기=숨김(전 OS)·완전 종료·트레이 아이콘·dock 숨김 | agent-desktop (`apps/desktop/**`) | T0 | MEDIUM |
| T4 | 통합·E2E(서식·메모·영역 가지)·독립 리뷰 | lead + reviewer | T1–T3 | HIGH |
| T5 | 스크린샷 390/768/1440·데스크톱 빌드·실행·백그라운드 smoke | lead | T4 | MEDIUM |
| T6 | 문서(01/02/04/README/PROGRESS/DECISIONS)·커밋 | lead | T5 | LOW |

모델: 모든 agent는 현재 모델 상속(Opus 5.5). effort 별도 지정 불가 → 독립 리뷰어로 보완.

## 검증
- core 단위: annotation CRUD·빈 서식 삭제·세션 삭제 연쇄·겹침 찾기, sync 검증기(잘못된 색/offset/긴 메모 거부), host↔client 왕복.
- ui: Dexie v3 업그레이드(기존 v2 DB 열기), 백업 호환.
- E2E: 선택→형광펜→새로고침 유지, 메모 저장·팝오버, 두 문단 가지 → `data-region` + 막대 존재.
- 수동: 데스크톱 창 닫기 → 웹 계속 동작 → 트레이 완전 종료.
