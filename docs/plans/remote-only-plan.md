# IMP-06 · 웹·모바일 원격 전용 전환 (PC 호스트 동기화)

## 목표
웹·모바일은 **PC(데스크톱 앱)의 원격 화면**이 된다.
- 페어링하면 PC에서 학습 중인 세션 트리·메시지·요약을 그대로 본다(실시간 스트리밍 포함).
- 질문/가지/요약/재시도/중지/이름 변경/삭제는 **신호(액션)** 로 PC에 보내고, 실제 CLI 호출과 저장은 PC가 한다.
- 웹·모바일에서 API 키·로컬 저장·모델 선택·백업을 없애고 UI를 원격 전용으로 개편한다.

## 완료 기준 (관찰 가능)
1. 데스크톱 앱에서 [원격 페어링 열기] → 웹(개발 서버) 페어링 → PC 세션 목록·메시지가 보인다.
2. 웹에서 질문 → PC CLI가 응답, 웹·PC 양쪽에 스트리밍으로 보인다. PC에서 한 질문도 웹에 실시간 반영.
3. 웹에서 가지 만들기·요약 붙이기·이름 변경·삭제가 PC 데이터에 반영된다.
4. PC 연결이 끊기면 웹은 오프라인 배너 + 입력 비활성, 다시 연결되면 스냅샷으로 복구.
5. 웹·모바일 설정에 API 키/백업/모델 선택이 없다. 미페어링 시 첫 화면은 페어링 안내.
6. `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e` 통과, 데스크톱 `package:dir` 빌드·실행.

## 유지할 동작
- 데스크톱(PC): 로컬 CLI·API 키·Dexie 저장·백업·호스트 카드·모델 칩 그대로. "다른 PC에 연결"(remote-bridge provider)도 유지.
- 헤드리스 bridge(`npx @branch/bridge --pair`)와 기존 `chat.start` 원격 프로토콜 유지(데스크톱의 "다른 PC에 연결"이 사용).
- 데모 모드(`#scenario=`)와 개발 서버 `?platform=desktop` 화면 전환 유지.
- 정책: OAuth/인증 파일 미접근, 헤더 위조 없음, 비밀 값 로그 금지. E2E 암호화 채널 그대로.

## 아키텍처
```
[웹/모바일 renderer]                        [데스크톱 main]                     [데스크톱 renderer]
appStore(메모리, 원격 모드)                 RemoteServer(E2E 채널)               appStore(Dexie, 진실 원천)
 └ createSyncClient(store, link) ⇄ ws/relay ⇄ onSync(peer,msg) ⇄ IPC host:sync-in/out ⇄ createSyncHost(store, send)
                                                                                  └ registry(Claude/Codex CLI) → bridge
```
- **진실 원천 = 데스크톱 renderer 스토어**. main은 메시지를 중계만 한다(엔진은 renderer).
- 동기화 로직(호스트/클라이언트)은 **core 순수 모듈**로 두고 in-memory 전송으로 Vitest 통합 테스트.
- 엔진 미준비(창 닫힘·로드 중) → main이 `sync.error`로 응답. 엔진 준비 시 main이 `sync.reset` 브로드캐스트 → 클라이언트 재요청.
- macOS에서 호스트가 켜져 있으면 창 닫기 = 숨기기(엔진 유지). 다른 OS는 기존대로 종료.

## 공통 계약 — `packages/core/src/bridge/sync.ts` (리더 작성, 변경은 리더만)
- 클라이언트 → 호스트: `sync.hello`, `sync.messages{sessionId}`, `act{reqId, op}`
- 호스트 → 클라이언트: `sync.snapshot{hostName, sessions, streaming, summaryDrafts}`, `sync.messages{sessionId, messages}`,
  `sync.session{session}|{deleted:ids}`, `sync.message{message}|{deleted, sessionId}`, `sync.streaming{streaming}`,
  `sync.draft{sessionId, draft|null}`, `act.result{reqId, ok, error?}`, `sync.error{error}`, `sync.reset`
- op: `newRoot{id}`, `send{sessionId,text,messageId}`, `stop`, `retry`, `branch{id,parentId,anchor,kind,question?,messageId}`,
  `rename{title}`, `delete`, `summary.request|discard|remove`, `summary.attach{text?}`
- id는 클라이언트가 만든다(낙관적 표시 → 호스트 push가 덮어씀). `validateSyncClientMsg`/`isSyncServerMsg`로 엄격 검증.
- 메시지는 **세션별 지연 로드**: 클라이언트가 화면에 보이는 세션만 `sync.messages` 요청. 호스트는 메시지 변경을 모든 동기화 피어에 push, 클라이언트는 로드된 세션만 반영.
- 스트리밍 push는 메시지 단위 throttle(약 120ms), 완료/오류는 즉시.
- 호스트 정책: 원격이 만든 루트 세션은 PC `hostAgent`가 auto가 아니면 그 CLI로 지정(가지는 상속).

## Task Graph / 소유권
| ID | 내용 | 소유(쓰기) | 의존 | 난이도 |
|---|---|---|---|---|
| T0 | 계획·ADR-026·PROGRESS·sync 계약 | lead | - | HIGH |
| T1 | core: store 선택적 id, sync host/client, 검증기, 테스트, remote link 타입 확장 | agent-core (`packages/core/**`) | T0 | HIGH |
| T2 | bridge 서버 sync 라우팅 + 테스트 / desktop main·preload IPC 중계·엔진 준비·창 숨김 | agent-host (`packages/bridge/**`, `apps/desktop/**`) | T0 (T1 타입) | HIGH |
| T3 | UI: 원격 모드 스토어·런타임, 호스트 엔진 연결, 온보딩·설정·상태칩·오프라인·숨김 처리, 모바일 | agent-ui (`packages/ui/**`, `apps/mobile/**`) | T1,T2 API | HIGH |
| T4 | E2E: 기존 흐름은 `?platform=desktop`(로컬 모드), 원격 모드 E2E(테스트 호스트) | agent-ui 이후 lead | T3 | MEDIUM |
| T5 | 통합 검증·독립 리뷰·스크린샷(390/768/1440)·데스크톱 빌드·실제 페어링 smoke | lead + reviewer | T1–T4 | HIGH |
| T6 | 문서(01/02/03/04, README, PROGRESS, DECISIONS) + 커밋 | lead | T5 | LOW |

모델: 모든 agent는 현재 모델 상속(Opus 5.5). 별도 effort 지정 불가 → 리뷰어 분리로 보완.

## 검증
- core: sync host↔client in-memory 통합 테스트(스냅샷, 지연 로드, 질문→스트리밍→완료, 가지, 요약, 삭제, 재연결, 잘못된 메시지 거부).
- bridge: 서버가 sync 메시지를 onSync로 넘기고 sendTo/broadcast가 해당 피어에만 가는지, 미지원(헤드리스) 시 `sync.error`.
- UI/E2E: 1440·390, 원격 모드(테스트 호스트) 페어링→보기→질문→가지.
- 실제: 데스크톱 앱 호스트 ↔ 웹 개발 서버(:5173) 페어링, Claude CLI 실제 응답.

## 알려진 제약
- 원격 검색은 제목과 이미 불러온 메시지만 대상.
- PC 앱이 꺼져 있거나(Windows/Linux에서 창 닫음) 잠자기면 원격은 오프라인.

## 모듈 API (T1이 구현, T2·T3이 사용)
```ts
// packages/core/src/sync/host.ts
createSyncHost(opts: {
  store: AppStore;
  hostName: () => string;
  /** peerId '*' = 동기화 중인 모든 피어 */
  send: (peerId: string, msg: SyncServerMsg) => void;
  /** 원격이 만든 루트 세션에 적용할 CLI (PC hostAgent). undefined면 기본 provider */
  rootProvider?: () => ProviderId | undefined;
  throttleMs?: number; // 기본 120
}): { receive(peerId: string, msg: SyncClientMsg): void; dispose(): void };

// packages/core/src/sync/client.ts
interface SyncLink {
  send(msg: SyncClientMsg): void;
  subscribe(cb: (msg: SyncServerMsg | BridgeServerMsg) => void): () => void;
  onDisconnect(cb: () => void): () => void;
  ensure(): Promise<unknown>;
}
type SyncStatus = 'unpaired' | 'connecting' | 'online' | 'offline' | 'unsupported';
createSyncClient(opts: { store: AppStore; link: SyncLink; isPaired: () => Promise<boolean>; timeoutMs?: number }):
  { state: StoreApi<{ status: SyncStatus; hostName?: string; error?: string; loaded: Record<ID, true> }>;
    start(): void; stop(): void; reconnect(): void; ensureMessages(sessionId: ID): void };
// start() 시 스토어의 데이터 액션(new/send/branch/…)을 원격 액션 전송으로 바꾼다. 보기 액션은 로컬 그대로.

// packages/core/src/bridge/sync.ts
validateSyncClientMsg(raw: unknown): SyncClientMsg | null; isSyncServerMsg(raw: unknown): raw is SyncServerMsg;
isSyncClientType(type: unknown): boolean;
```
- bridge `RemoteServerOptions.sync?: { receive(peerId, deviceId, msg: SyncClientMsg): void; peerGone?(peerId): void }`,
  `RemoteServer.syncSend(peerId | '*', msg: SyncServerMsg)`. sync 옵션이 없으면 sync 메시지에 `sync.error` 응답.
- desktop IPC: main→renderer `host:sync-in {peerId, msg}`, renderer→main `host:sync-out {peerId, msg}`, renderer→main `host:sync-ready (bool)`.
  `DesktopHostApi.sync?: { ready(on: boolean): void; send(peerId, msg): void; onMessage(cb): () => void }`.

## Critic 리뷰 반영 (필수 요구사항)
### core (T1)
- **id 검증**: 호스트 `receive`는 `SYNC_ID_RE` 형식 + 기존 세션 id/모든 메시지 id와 충돌 시 `act.result{ok:false,error:'conflict'}`.
- **실패 보고**: id를 받는 store 액션(`newRootSession(id?, {focus?})`, `createBranch(..., ids?)`, `sendMessage(..., messageId?)`)과 `retry`는 성공 여부를 `boolean`으로 반환(기존 호출부 호환). 호스트는 모든 op를 사전 검사 + try/catch → 실패 코드(`SyncActError`). 클라이언트는 `ok:false`/타임아웃 시 낙관적 엔티티 롤백.
- **PC 화면 보존**: `newRootSession(id, {focus:false})` — 원격이 만든 루트는 PC 보기를 바꾸지 않는다.
- **클라이언트 적용 경로**: `load()` 대신 저장소에 쓰지 않는 `applyRemote`(setState) 경로. `sync.session{deleted}`는 `deleteSession`과 같은 보기 정리(split·popups·sheets·active).
- **호스트 diff는 `store.subscribe`로**: 액션 래핑이 아니라 sessions/messages/streaming/summaryDrafts 참조 비교 → 제목 자동 생성·PC에서의 변경도 전파.
- **스트리밍**: `sync.append{offset,text}` 증분(메시지별 120ms throttle). 상태 변화·`sync.streaming`·삭제 전에 대기 중 push flush, 메시지 삭제 시 타이머 취소. offset 불일치 시 클라이언트가 `sync.messages` 재요청.
- **페이지**: `sync.messages`는 `SYNC_LIMITS.pageBytes` 단위 `{first, done}`. 단일 메시지가 예산 초과여도 1개는 보낸다(100k자 < 4MB).
- **안전**: 피어당 rate limit(`actCount/actWindowMs`), 피어당 동시 스트림 1개(`busy`), 앵커 검증(부모에 messageId 존재, 0≤start<end≤content.length, text≤10k), 삭제는 호스트 옵션 `allowDelete?: () => boolean`(false면 `forbidden`). 호스트 `onRemoteAction?(peerId, op)` 콜백(PC 토스트용).
- **reset**: 호스트 스토어에서 `load()`가 일어나면(백업 복원 등) `sync.reset` 브로드캐스트.
- **링크**: `act`는 큐잉 금지 — online일 때만 전송, 아니면 즉시 실패. 연결 후 클라이언트가 `ensure()` → `sync.hello` → `loaded` 초기화 → 보이는 세션 재요청. `onDisconnect`에 자체 백오프 재연결(1s→2s→…30s). remote link 송수신 타입을 sync 메시지로 확장.
- **원격 모드 스토어 옵션**: `sanitizeSettings`·fallback 재시도 제안·연결 상태 기반 게이트를 원격 모드에서 끈다(createAppStore 옵션 또는 client.start()가 오버라이드).
### bridge/desktop (T2)
- 서버는 `validateClientMsg` **이전에** sync 타입을 라우팅. peerId는 **소켓 단위**(같은 기기 두 탭 구분). 소켓 종료·페어 해제 시 `peerGone`. `'*'`는 `sync.hello`를 보낸 피어에게만.
- main: `host:sync-out`의 sender가 엔진 창 webContents인지 확인, `sync-in`은 그 창에만. 엔진 미준비 시 sync 메시지에 `sync.error{error:'not-ready'}`.
- `ready(false)`: `did-start-navigation`, `destroyed`, 렌더러 크래시. 준비 → `sync.reset` 브로드캐스트.
- 호스트 켜짐 동안 `webPreferences.backgroundThrottling=false`(또는 `webContents.setBackgroundThrottling(false)`).
- macOS 창 닫기=숨기기: `before-quit`에서 quitting 플래그(Cmd+Q 정상 종료), `activate`는 숨긴 창 show(엔진 중복 생성 금지).
### UI (T3)
- 렌더러 엔진은 `loadPersisted` 완료 후에만 `ready(true)`, 데모 모드(`#scenario`)에서는 `ready(false)`.
- 원격 모드: 온보딩·입력 게이트는 페어링/동기화 상태 기준. 테마·앵커 설정은 localStorage에 보존(메모리 스토어라도 유지).
- 기존 웹·모바일 IndexedDB 데이터: 데이터가 있으면 설정에 "이전 기기 데이터 내보내기(JSON)" 1회성 제공(PC 앱에서 백업 복원으로 가져오기).
- PC 설정(호스트 카드)에 "원격에서 삭제 허용" 토글(기본 켬) + 원격 조작 토스트.
- 공유 상태(요약 초안·스트리밍)는 PC와 공유됨 — 문서화.
