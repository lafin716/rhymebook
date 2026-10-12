# 02 · Architecture

## 모노레포 구조 (pnpm workspace)

```
/
├─ packages/
│  ├─ core/      @branch/core   도메인 모델·순수 로직·Zustand 스토어·Provider 인터페이스 (DOM/Node 의존 없음)
│  ├─ ui/        @branch/ui     Vite + React + TS + Tailwind SPA (모든 플랫폼 공유)
│  ├─ bridge/    @branch/bridge Node/TS: 공식 CLI 실행 + WebSocket 서버 (Electron 내장/헤드리스 겸용)  [Phase 3~4]
│  └─ relay/     @branch/relay  아웃바운드 WebSocket 중계, 페이로드 E2E 암호화                     [Phase 6]
├─ apps/
│  ├─ web/       ui 정적 빌드 (Phase 1~)
│  ├─ desktop/   Electron (main 프로세스에서 bridge 내장) [Phase 3]
│  └─ mobile/    Capacitor (iOS/Android)                   [Phase 5]
└─ docs/
```

의존 방향: `ui → core`, `bridge → core(타입·프로토콜)`, `relay`는 독립(프로토콜 타입만 공유).
`core`는 플랫폼 무관해야 하므로 `window`, `document`, `fs` 등을 import하지 않는다.

### core 내부 모듈
| 경로 | 책임 |
|---|---|
| `model.ts` | Session, Message, Anchor, ViewState 등 타입 |
| `anchor.ts` | 렌더 텍스트 ↔ 원문 offset 매핑, 텍스트 매칭 복원 (순수 함수) |
| `context.ts` | `buildBranchContext()` — 조상 앵커 체인 + 부모 최근 N개 + 지시문 |
| `tree.ts` | 조상/자손/경로/breadcrumb 계산 |
| `provider.ts` | `LLMProvider` 인터페이스, `ProviderRegistry`, 오류 타입 |
| `providers/mock.ts` | MockProvider(가짜 스트리밍, 시나리오 제어 가능) |
| `store/*` | Zustand 스토어: sessions, messages, view, settings, connections |
| `repo.ts` | `Repository` 인터페이스 (메모리 구현 → Phase 2 Dexie 구현) |
| `seed.ts` | 데모 시드 데이터 |

### ui 내부 구조
| 경로 | 책임 |
|---|---|
| `app/` | AppShell, 라우팅(해시 기반 상태), 반응형 훅, 테마 |
| `chat/` | ChatPanel, MessageList, MessageItem, Markdown(+앵커 rehype 플러그인), Composer, SummaryCard |
| `branch/` | 선택 감지, SelectionMenu(데스크톱), SelectionActionBar(모바일), 가지 생성 플로우 |
| `session/` | SessionHeader(breadcrumb·앵커 인용·provider·액션), Sidebar(세션 트리) |
| `views/` | SplitView / MobileTabs, PopupLayer / BottomSheet, MindMap |
| `search/` | CommandPalette (Cmd+K) |
| `settings/` | 연결 카드, CLI 상태, 페어링 QR, provider 순서 |
| `demo/` | 시나리오 점프 메뉴 (개발 모드 전용) |
| `components/` | 공통 프리미티브(Button, IconButton, Sheet, Badge, StatusDot …) |

## 데이터 모델

```ts
type ID = string; // nanoid 스타일

interface Anchor {
  messageId: ID;      // 부모 세션의 assistant 메시지
  text: string;       // 선택된 원문 텍스트(렌더 기준으로 사용자가 본 텍스트)
  startOffset: number; // 메시지 content(markdown 원문) 기준 시작 offset
  endOffset: number;   // 끝 offset (exclusive)
}

interface Session {
  id: ID;
  parentId: ID | null;
  rootId: ID;           // 루트는 자기 자신
  title: string;
  anchor?: Anchor;      // 서브세션만
  summary?: string;     // 부모에 되돌린 1~2문장 요약
  providerId?: string;  // 세션별 provider (없으면 기본값)
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: ID;
  sessionId: ID;
  role: 'user' | 'assistant';
  content: string;      // markdown 원문
  createdAt: number;
  status?: 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
}
```

`ViewState`(영속 대상):
```ts
interface ViewState {
  mode: 'single' | 'split' | 'mindmap';
  activeSessionId: ID | null;
  splitSessionIds: ID[];      // 최대 3
  splitSizes?: number[];
  popups: { id: ID; sessionId: ID; x: number; y: number; w: number; h: number; z: number }[];
  mobileSheetSessionId: ID | null;
}
```
팝업은 mode와 독립된 오버레이 레이어다(분할/단일 위에 띄움).

### 앵커 저장·복원 알고리즘
1. 렌더 시 rehype 플러그인이 hast 텍스트 노드를 문서 순서로 순회하며 **세그먼트 맵**
   `{renderStart, sourceStart, length}[]`을 만든다. 텍스트 노드의 `position.start.offset`을
   1차 근거로, 일치하지 않으면(이스케이프/엔티티/구문 강조로 분할된 노드) 원문에서 커서 이후 `indexOf`로 보정한다.
2. 사용자가 선택하면 메시지 컨테이너 시작~선택 시작까지 `Range.toString().length`로 렌더 offset을 얻고,
   세그먼트 맵으로 **원문 offset**으로 변환해 저장한다(`text`는 렌더 기준 선택 텍스트).
3. 복원 시 렌더 텍스트에서 `anchor.text`의 모든 출현 위치를 찾고(공백 정규화 fallback),
   원문 offset으로 환산했을 때 `startOffset`과 가장 가까운 후보를 선택한다 → 해당 렌더 범위를 `<mark data-anchor>`로 분할 래핑.
4. 매칭 실패 시 앵커는 "원문에서 찾을 수 없음" 상태로 메시지 하단 카드 영역에만 표시한다.

core(`anchor.ts`)는 세그먼트 맵 기반 변환/매칭만 담당하고, hast 순회·DOM Range는 ui가 담당한다.

### 서식·메모·영역 표시 (IMP-07)
- `Annotation {id, sessionId, anchor, highlight?, underline?, textColor?, font?, bold?, italic?, note?}` — 가지 앵커와 같은 원문 offset 규칙(ADR-029). Dexie v3 `annotations: 'id, sessionId'`, 백업 스냅샷 `annotations?`, 세션 삭제 시 연쇄 삭제. 순수 함수는 core `annotations.ts`.
- `rehypeAnchors`가 가지 앵커와 annotation 경계를 함께 잘라 `span.annot[data-hl|ul|tc|font|bold|italic|note]` 안에 `mark.anchor`를 둔다. 표시 아이콘은 CSS pseudo-content라 DOM textContent = 렌더 텍스트가 유지된다.
- 앵커가 2개 이상 블록에 걸치면 조각 mark에 `data-region`(배경 없음), `RegionGutter`가 mark 사각형을 측정(layout effect + ResizeObserver/MutationObserver)해 왼쪽 막대를 그리고 겹치면 lane으로 나눈다(ADR-030).
- 원격: sync op `annot.set`/`annot.delete`, push `sync.annot`, 스냅샷 `annotations`. 클라이언트는 낙관적 적용 + 실패 시 롤백.

## 상태 관리

- **Zustand** 스토어(core)를 단일 진실 원천으로 사용한다. ui는 selector로 구독한다.
- 슬라이스: `sessions`(Record<ID, Session>), `messages`(Record<sessionId, Message[]>), `view`, `settings`, `connections`, `streams`(진행 중 요청 AbortController).
- 액션(예): `createRootSession`, `createBranch(parentSessionId, anchor, kind, question?)`, `sendMessage`, `stopStream`,
  `attachSummary`, `openSession(id, target: 'main'|'split'|'popup'|'sheet')`, `setMode`, `closePopup`, `reorderFallback`.
- 영속화는 `Repository` 인터페이스 뒤에 숨긴다. 프로토타입=메모리, Phase 2=Dexie. 스토어는 변경 시 repo에 쓰기(debounce), 시작 시 hydrate.
- 스트리밍: `sendMessage`가 provider `stream()`의 AsyncIterable을 소비하며 assistant 메시지 content를 append. 16ms 단위 배치 업데이트.

## 플랫폼별 빌드

| 플랫폼 | 셸 | LLM 경로 | 비밀 저장 |
|---|---|---|---|
| 웹 | `apps/web` (Vite 정적 빌드) | **원격 전용**: PC 데스크톱 앱 스토어 미러 + 액션 신호(ADR-026) | 페어링은 탭 메모리(새로고침 시 다시 페어링) |
| 데스크톱 | `apps/desktop` Electron | 내장 bridge(IPC/로컬 WS) → CLI, 또는 API | Electron `safeStorage` |
| 모바일 | `apps/mobile` Capacitor | **원격 전용**: PC 스토어 미러 + 액션 신호(LAN·Tailscale·relay, ADR-026) | Capacitor secure storage(페어링 키) |

### 원격 동기화 (ADR-026)
- 진실 원천은 PC 데스크톱 renderer 스토어(Dexie) 하나. 웹·모바일 스토어는 메모리 미러(`remote: true`)이며 보기 상태와 테마만 로컬.
- 프로토콜(core `bridge/sync.ts`): `sync.hello`→`sync.snapshot`(세션·스트리밍·요약 초안), 세션별 지연 로드 `sync.messages`, 변경 push(`sync.session/message/append/streaming/draft`), 액션 `act{op}`→`act.result`, 엔진 재시작 `sync.reset`. E2E 암호화 채널 위에서 엄격 검증.
- 경로: 원격 기기 → bridge RemoteServer → 데스크톱 main → IPC → renderer 호스트 엔진(core `createSyncHost`) → 스토어 액션 → CLI. 클라이언트는 core `createSyncClient`(낙관적 표시 + 실패·타임아웃 롤백, 끊김 시 지수 백오프 재연결, 삭제된 세션은 부모로 포커스 이동).
- 원격 루트 세션의 에이전트: PC `hostAgent`, 자동이면 준비된 CLI(Claude 우선), 둘 다 없으면 PC 기본 provider. 헤드리스 bridge는 sync를 지원하지 않는다(`sync.error` → "PC 앱 업데이트" 안내).

- 백그라운드 호스트(ADR-028): 호스트가 켜져 있으면 창 닫기 = 숨김(renderer 엔진 유지, throttling 끔) + 트레이 아이콘. 트레이 [완전 종료]·⌘Q만 실제 종료.

플랫폼 차이는 ui의 `platform/` 어댑터(`SecretStore`, `BridgeTransport`, `openExternal`)로 주입한다.
ui 번들은 모든 플랫폼에서 동일하다.

## 개발/테스트 도구
- TypeScript strict, ESLint(flat config), Vitest(core 단위 테스트), Playwright(Phase 7 E2E)
- `pnpm dev` = ui 개발 서버(`--host` 노출, 포트 5173)
