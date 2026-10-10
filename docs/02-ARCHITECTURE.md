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
| 웹 | `apps/web` (Vite 정적 빌드) | API 직접 호출(BYOK, CORS 허용 헤더) / 원격 Bridge | 세션 메모리 + 경고 |
| 데스크톱 | `apps/desktop` Electron | 내장 bridge(IPC/로컬 WS) → CLI, 또는 API | Electron `safeStorage` |
| 모바일 | `apps/mobile` Capacitor | API 직접 / 원격 Bridge(LAN·Tailscale·relay) | Capacitor secure storage |

플랫폼 차이는 ui의 `platform/` 어댑터(`SecretStore`, `BridgeTransport`, `openExternal`)로 주입한다.
ui 번들은 모든 플랫폼에서 동일하다.

## 개발/테스트 도구
- TypeScript strict, ESLint(flat config), Vitest(core 단위 테스트), Playwright(Phase 7 E2E)
- `pnpm dev` = ui 개발 서버(`--host` 노출, 포트 5173)
