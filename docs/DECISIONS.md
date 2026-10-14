# Decisions (ADR, 짧게)

형식: `ADR-번호 · 날짜 · 제목` / 맥락 / 결정 / 근거·대안

---

### ADR-001 · 2026-10-09 · 패키지 스코프와 도구 체인
- 결정: npm 스코프 `@branch/*`, pnpm workspace, TypeScript strict, Vite + React 19 + Tailwind v4(`@tailwindcss/vite`), Vitest, ESLint flat config.
- 근거: 사용자 지정 스택. Tailwind v4는 설정 파일 없이 CSS 토큰으로 테마 관리가 쉬움.

### ADR-002 · 2026-10-09 · 앵커 offset은 markdown 원문 기준, 복원은 텍스트 매칭 + offset 근접 선택
- 맥락: 렌더 텍스트와 원문은 markdown 문법(`**`, 백틱, 링크) 때문에 offset이 다르다.
- 결정: hast 텍스트 노드의 source position으로 렌더↔원문 세그먼트 맵을 만들고, 선택은 원문 offset으로 저장.
  복원은 렌더 텍스트에서 `anchor.text` 후보를 찾아 원문 offset이 가장 가까운 후보를 고른다.
- 근거: 사용자 지정("원문 offset 저장 + 텍스트 매칭 복원"). 같은 단어가 여러 번 나와도 정확한 위치를 고를 수 있다.

### ADR-003 · 2026-10-09 · 팝업은 보기 모드가 아닌 오버레이 레이어
- 결정: `view.mode ∈ {single, split, mindmap}` + 독립 `popups[]` 레이어.
- 근거: 분할 보기 위에 팝업을 띄워 함께 쓰는 흐름이 자연스럽다. 모바일에서는 팝업 = 바텀시트 1개(스택).

### ADR-004 · 2026-10-09 · 라우팅 라이브러리 미사용
- 결정: 화면 상태는 스토어(view/overlay)로 관리하고, 데모 점프만 URL hash(`#scenario=…`)로 지원.
- 근거: 데스크톱/모바일 셸에서 동일 동작, 분할·팝업 다중 상태는 URL 표현이 부적합.

### ADR-005 · 2026-10-09 · TypeScript 5.9 고정
- 결정: `typescript ~5.9.3`으로 고정.
- 근거: typescript-eslint 8의 peer 범위가 `>=4.8.4 <6.1.0`. 그 범위의 안정 버전인 5.9.3에 고정하고, 지원 범위가 넓어지면 올린다.

### ADR-006 · 2026-10-09 · Zustand 셀렉터는 안정 참조만 반환
- 결정: `useApp((s) => …)`는 원시값/스토어 내 기존 참조만 반환하고, 파생 객체·배열은 `useMemo`로 만든다.
- 근거: Zustand 5 + React 19에서 매 렌더 새 객체를 반환하면 getSnapshot 무한 루프가 난다(프로토타입에서 실제 발생 후 수정).

### ADR-007 · 2026-10-09 · 앵커 인용 발췌는 core에서 계산
- 결정: 서브세션 헤더의 원문 발췌(`excerptAround`: markdown 기호 제거, 줄 머리 정리)는 `@branch/core`의 순수 함수로 두고 단위 테스트한다.
- 근거: 웹/데스크톱/모바일 공통 로직이며 테스트 용이.

### ADR-008 · 2026-10-09 · 모바일 마인드맵은 위→아래 배치
- 결정: 모바일(< 768px)은 dagre `rankdir: TB` + 좁은 노드(156px), 데스크톱은 `LR` + 220px.
- 근거: 375px에서 LR 배치는 fitView 후 노드 글자가 읽히지 않을 만큼 작아짐(스크린샷 검증).

### ADR-009 · 2026-10-09 · 전역 focus-visible 스타일은 `@layer base`
- 결정: 전역 `:focus-visible` 외곽선을 Tailwind base 레이어에 둔다.
- 근거: 레이어 밖 규칙은 유틸리티(`focus-visible:outline-none`)보다 우선해 검색 입력 등에서 덮을 수 없었다.

### ADR-010 · 2026-10-09 · 백업은 시점별 스냅샷 + 플러그형 대상(파일/구글 드라이브/GitHub)
- 결정: core에 `BackupTarget { id; label; available(); list(); put(snapshot); get(id) }` 인터페이스와 버전 있는 JSON 스냅샷(`schemaVersion`)을 둔다. 대상은 파일(항상), 구글 드라이브(`drive.appdata` 범위, 앱 전용 숨김 폴더), GitHub(fine-grained PAT 단일 저장소, contents API). 복원은 합치기(id 기준 `updatedAt` 최신 우선)/교체, 복원 전 자동 백업. 선택형 패스프레이즈 암호화(WebCrypto PBKDF2 + AES-GCM).
- 근거: 사용자 요청(드라이브 또는 GitHub). 실시간 동기화는 충돌 해결·계정 체계가 필요해 범위 밖으로 유지하고, 백업은 구현·검증이 단순하다. appdata 범위는 사용자의 다른 파일에 접근하지 않아 권한 부담이 가장 작다. 토큰은 API 키와 같은 보관 규칙, 비밀 값은 스냅샷에 넣지 않는다.
- 대안: 실시간 동기화(CRDT) — 범위 과다. Drive 전체 `drive.file` — 사용자가 파일을 볼 수 있지만 실수 삭제 위험, 추후 "보이는 폴더로 내보내기" 옵션으로 고려.

### ADR-011 · 2026-10-09 · 설정 공용 컨트롤 분리
- 결정: `Section/Toggle/Field/Segmented`를 `packages/ui/src/settings/controls.tsx`로 분리, 탭별 파일(BackupTab 등)이 공유.
- 근거: 설정 탭 증가에 따른 순환 import 방지.

### ADR-012 · 2026-10-09 · 웹 API Provider · 런타임 레지스트리 · 데모 라우팅
- 결정: core에 `createAnthropicProvider`/`createOpenAIProvider`(fetch + 자체 SSE 파서 `readSse`, SDK 미사용)와 `createRuntimeRegistry`를 둔다. 키는 `SecretStore` 인터페이스로만 조회하고(웹 = `memorySecretStore`, 탭 메모리), 화면에는 `maskSecret` 결과만 표시한다. 키 저장 시 `GET /v1/models`로 토큰 소모 없이 확인하며, 401/403이면 저장하지 않는다.
- 결정: Anthropic 브라우저 직접 호출은 공식 opt-in 헤더 `anthropic-dangerous-direct-browser-access: true`를 사용한다. 이는 Anthropic이 문서화한 BYOK용 헤더로, 클라이언트 위조가 아니다(정책 원칙 준수). OpenAI는 브라우저 CORS를 기본 허용한다.
- 결정: 데모 모드(`#scenario=` 해시 또는 데모 바 시나리오 실행)에서는 `routeProvider`가 모든 provider를 Mock으로 보낸다. 실제 모드 기본 provider는 `anthropic-api`(`RUNTIME_SETTINGS`)이고, 키가 없으면 오프라인 배너가 대체 provider/설정을 안내한다. 연결별 모델은 `ConnectionState.model`(기본 `claude-sonnet-5`/`gpt-5`)에 둔다.
- 결정: 요약 재요청은 이전 요청을 abort하고, 현재 컨트롤러가 아닌 응답은 초안을 덮지 않는다. 에러 시 부분 텍스트를 보존한다.
- 근거: 플랫폼 무관 core 유지(DOM/Node import 없이 `fetch`/`ReadableStream`만 사용), 테스트 용이(fetch 주입). 개발 검증은 `VITE_ANTHROPIC_BASE_URL`로 로컬 모의 SSE 서버를 가리켜 수행했다.

### ADR-013 · 2026-10-09 · 겹치는 앵커는 조각(piece)으로 렌더, indexOf 폴백은 범위 제한
- 결정: `layoutAnchorRanges`가 모든 앵커 경계에서 텍스트를 잘라 조각마다 `<mark>`를 만들고, 대표 id(가장 짧은 = 가장 안쪽 앵커)와 덮는 전체 id 목록(`data-session-ids`)을 단다. 겹친 조각은 `data-nested`로 진하게 표시한다. 위치 판정·원문 이동은 `data-session-ids~=` 선택자를 쓴다.
- 결정: 원문 position이 없는 텍스트 노드(하이라이트로 분리된 노드 등)는 가장 가까운 조상의 position을 `bound`로 받아, indexOf 폴백이 그 범위를 벗어나 오매칭하지 않게 한다.
- 근거: 2단계 독립 리뷰 지적(겹친 앵커가 "위치 못 찾음"으로 오판, 코드 블록 뒤 동일 문자열 오매칭). UX(클릭 = 가장 안쪽 가지 열기)는 변경 없음.

### ADR-014 · 2026-10-09 · Dexie 영속화는 ui 어댑터 + core 순수 복원 함수
- 결정: Dexie 저장소(`BranchDB`, DB 이름 `branch-learn`)는 `packages/ui/src/persist`에 두고 core `Repository` 인터페이스를 구현한다(core는 DOM/IndexedDB import 금지). 스키마 v1: `sessions(id,parentId,rootId)`, `messages(id,sessionId,[sessionId+seq])`, `kv(key)` — kv에는 view/settings/connections.
- 결정: 스토어 쓰기는 fire-and-forget이며 저장소 내부 promise 체인으로 직렬화한다(`flush()`로 대기). 메시지 순서는 세션 목록 인덱스를 `seq`로 저장한다. 하위 트리 삭제 시 메시지도 함께 지운다.
- 결정: 스트리밍 메시지는 시작 시 + 약 1초 간격(`STREAM_SAVE_INTERVAL`) + 종료 시 저장하고, 복원 시 `streaming` 상태는 `stopped`(부분 응답 보존)로 바꾼다.
- 결정: 복원은 core `restoreData`/`sanitizeView`(순수 함수)로 한다 — 고아·순환 세션 제거, 존재하지 않는 세션을 가리키는 분할/팝업/시트 제거, 분할 크기·포커스 보정. 연결은 사용자 선호(enabled/model)만 저장하고 상태·키·마스킹 값은 저장하지 않는다(비밀 값 비영속).
- 결정: 첫 실행은 시드를 DB에 기록한다. 데모 모드는 `gatedRepository`로 저장을 끄고, 데모 종료 시 DB에서 다시 불러온다. IndexedDB 로드 실패 시 메모리 전용으로 계속 동작한다.
- 근거: Phase 2 완료 기준(새로고침 후 트리·앵커·요약·보기 상태 유지). fake-indexeddb 단위 테스트 + 실제 브라우저 새로고침 검증.

### ADR-015 · 2026-10-09 · 백업 구현: core 매니저 + ui 서비스, 토큰·암호 비영속
- 결정: core `packages/core/src/backup/`에 스냅샷 직렬화·암호화(PBKDF2 310k + AES-GCM)·`applyBackup`(합치기/교체)·`createBackupManager`(이 기기 대상 + 원격 대상 동시 기록, 보관 개수 정리, 복원 전 자동 백업)·GitHub contents API 대상(json + 읽기용 `latest.md`)·Drive `appDataFolder` 대상을 순수 TS(fetch 주입)로 둔다.
- 결정: ui `backup/service.ts`(Zustand)가 설정(kv `backup`: 자동·보관·암호화 여부·저장소 이름·마지막 백업 시각)을 저장한다. 토큰은 `SecretStore`(`secretName.backupToken`)에만, 백업 암호는 메모리에만 둔다. 이 기기 사본은 Dexie v2 `backups` 테이블, `replaceAll`은 백업 설정·기록을 지우지 않는다.
- 결정: 자동 백업은 30초 틱으로 `shouldAutoBackup`(변경 후 3분 유휴 또는 하루 1회)을 확인하고, 스트리밍 중·암호 미입력·데모 모드에서는 건너뛴다. 데모 모드는 메모리 대상을 써 실제 DB를 건드리지 않는다.
- 결정: 복원 후 연결 상태(기기별)는 유지하고 설정 창은 열어 둔다. 목록 항목은 `targetId|id`로 식별(대상마다 파일 이름이 같을 수 있음).
- 결정: Google 클라이언트 ID(`VITE_GOOGLE_CLIENT_ID`)가 없으면 드라이브는 IndexedDB 모의 대상으로 동작(B-01). 실제 연결은 공식 Google Identity Services 토큰 클라이언트.
- 부수 수정: 설정 연결 카드의 `hasKey`가 Promise를 진리값으로 판정하던 버그 → 연결 상태(`no-key` 여부)로 판단.

### ADR-016 · 2026-10-10 · CLI 실행 방식(Claude/Codex) · 무상태 · 도구 비활성
- 결정: `packages/bridge`가 공식 CLI만 `child_process.spawn`으로 실행한다(셸 미사용, 윈도우만 `shell:true` + 인수 따옴표, 종료 코드 9009 = 미설치).
  - Claude: `claude -p --output-format stream-json --verbose --include-partial-messages --tools "" --system-prompt-file <tmp> --no-session-persistence --strict-mcp-config --setting-sources ""` (프롬프트는 stdin). `text_delta`로 토큰 스트리밍, `<synthetic>` 메시지·`is_error` result는 분류된 오류로.
  - Codex: `codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --color never -` (stdin). Codex JSON 이벤트는 토큰 단위가 아니라 `agent_message` 항목 단위로 오므로 항목마다 한 번에 delta로 낸다. 사용자 `config.toml`의 모델/MCP가 실행을 깨뜨리는 것을 막으려 `--ignore-user-config`를 쓴다.
- 결정: 히스토리는 앱이 소유하고 요청마다 `<conversation>` 기록 + 마지막 질문으로 무상태 실행한다(세션 재개 금지). Codex는 system 인자가 없어 `<instructions>`로 프롬프트 앞에 붙인다. 요청마다 `mkdtemp` 작업 폴더(cwd)를 만들고 끝나면 지운다.
- 결정: 로그인 감지는 공식 상태 명령만 사용(`claude auth status --json`, `codex login status`). 인증 파일은 읽지 않으며, 상태 문구에는 이메일·키 일부를 표시하지 않는다(로그인 방식만). stderr는 `sanitize()`로 ANSI·키·Bearer·이메일을 지운 뒤 분류(auth/rate-limit/network/cli)한다.
- 결정: 동시 실행 2개(세마포어), 요청 5분 제한, 중지 시 SIGTERM → 2초 후 SIGKILL, 상태 감지 10초 캐시.
- 근거: 03-PROVIDERS 정책 원칙. 실제 CLI(claude 2.1.283, codex 0.157.1)와 가짜 CLI 픽스처로 검증.

### ADR-017 · 2026-10-10 · Electron 구조: 내장 bridge(IPC) · safeStorage 금고 · PATH 해석
- 결정: Electron main이 `createBridgeServer`를 내장하고, renderer와는 WebSocket이 아닌 IPC(`bridge:send`/`bridge:msg`)로 같은 bridge 프로토콜 메시지를 주고받는다. renderer는 `contextIsolation + sandbox + nodeIntegration:false`, preload가 `window.branchDesktop`(core `DesktopApi`)만 노출한다. webContents마다 연결 1개, 파괴되거나 메인 프레임이 다른 문서로 이동하면 연결을 닫아 실행 중인 CLI를 정리한다(해시 이동은 제외).
- 결정: ui `runtime.ts`가 `window.branchDesktop`이 있으면 CLI provider를 `createBridgeProviders`(IPC 전송)로 레지스트리 `overrides`에 넣고, 비밀 값은 desktop SecretStore로 바꾼다. 웹 빌드는 기존 동작 그대로.
- 결정: 비밀 값은 `safeStorage`로 암호화해 `userData/secrets.json`(0600, 원자적 쓰기)에 암호문만 저장. 암호화를 쓸 수 없으면 메모리 전용 + 설정 경고 문구.
- 결정: GUI로 실행된 앱은 셸 PATH를 못 받으므로 로그인 셸(`$SHELL -ilc`, 4초 제한)에서 PATH를 얻고 `~/.local/bin`, `/opt/homebrew/bin` 등 흔한 위치를 덧붙인다. `BRANCH_CLAUDE_BIN`/`BRANCH_CODEX_BIN`으로 경로를 지정할 수 있다(테스트·특수 설치용).
- 결정: main/preload는 esbuild로 CJS 번들, renderer는 ui를 `--base ./`로 빌드해 `file://`로 로드. 개발 시 `BRANCH_DEV_URL`로 Vite 서버를 로드.
- 결정: pnpm이 electron 바이너리를 내려받도록 `onlyBuiltDependencies: [electron, esbuild]`. 설치 스크립트가 실행되지 않은 환경에선 electron 패키지 폴더에서 `node install.js`.
- 근거: 브라우저 렌더러에서 Node 접근 차단(보안), 웹/데스크톱 UI 코드 공유. 검증 환경(에이전트 셸)은 키체인 접근이 막혀 `safeStorage`가 false → E2E는 Chromium `--use-mock-keychain`으로 암호화 경로를, 플래그 없이 메모리 폴백을 각각 확인.

### ADR-018 · 2026-10-10 · 헤드리스 bridge·페어링·RemoteBridgeProvider (Phase 4)
- 결정: 암호는 WebCrypto 대신 @noble(ed25519/x25519/hkdf/xchacha20poly1305). http LAN·Tailscale 출처에서는 `crypto.subtle`이 없기 때문.
- 결정: bridge·기기 모두 Ed25519 신원 키. 연결마다 X25519 임시 키 → HKDF-SHA256(salt = transcript)으로 c2b/b2c 키 분리, XChaCha20-Poly1305 프레임(평문에 순번). transcript = sha256("branch-bridge/1" ‖ clientEph ‖ bridgeEph ‖ bridgePub), bridge는 transcript에 서명하고 기기는 auth/pair 요청에서 서명.
- 결정: 페어링 두 경로 — `branch://pair?u=&b=&t=` 링크/QR(bridge 키 고정, trust 'qr'), 주소 + 6자리 코드(TOFU, 앱에 지문 표시, trust 'code'). 토큰·코드는 1회용·5분, 코드 5회 오답 시 페어링 취소.
- 결정: bridge 저장소(BRANCH_BRIDGE_HOME 또는 ~/.config/branch-bridge, 디렉터리 0700·파일 0600)에는 기기 공개키만 저장. 앱 쪽 페어링 기록(기기 비밀키 포함)은 SecretStore `pairing:remote-bridge` — 웹은 메모리 전용이라 새로고침 시 재페어링.
- 결정: 인증된 기기라도 서버에서 `validateClientMsg`로 재검증(providerId 화이트리스트, 모델명 정규식으로 CLI 옵션 주입 차단, role은 user/assistant만). maxPayload 4MB, 인증 제한 10s, 30s ping.
- 결정: 웹/모바일에서는 원격 bridge 경유 claude-cli/codex-cli provider를 노출(`includeCli: !desktop`), 데스크톱은 내장 bridge 우선.
- 결정: 헤드리스 CLI `branch-bridge [serve|pair|devices|unpair]`, 루트 `pnpm bridge -- --pair`. 토큰·코드는 터미널에만 1회 표시, 로그에는 남기지 않는다.
- 결정: core의 `WebSocketLike.onmessage` 인자를 `never`로 두어 DOM WebSocket·ws 양쪽을 그대로 받는다.
- 근거: 03-PROVIDERS 페어링 설계, 비밀 값 비노출 규칙, 브라우저 secure context 제약.

### ADR-019 · 2026-10-10 · Capacitor 모바일: 진입점 주입 · 보안 저장소 · 딥링크 (Phase 5)
- 결정: apps/mobile은 자체 Vite 빌드(`base: './'`). 진입점 `src/main.ts`가 `Capacitor.isNativePlatform()`일 때만 `window.branchMobile`(core `MobileApi`)을 주입한 뒤 `import('@branch/ui/main')`. ui는 Capacitor에 의존하지 않는다(데스크톱 preload와 같은 구조).
- 결정: 비밀 값은 `@aparajita/capacitor-secure-storage`(iOS Keychain, Android Keystore AES-GCM), 키 접두어 `branch.`. ui `runtime.ts`는 desktop ?? mobile 금고를 쓰고 메모리 경고를 숨긴다.
- 결정: 페어링 링크는 `branch://pair` 커스텀 스킴(iOS CFBundleURLTypes, Android VIEW/BROWSABLE intent-filter). `@capacitor/app`의 `appUrlOpen` + 콜드 스타트 `getLaunchUrl`, UI 구독 전에 온 링크는 보관했다 전달. 앱 내 QR 카메라 스캐너는 넣지 않고 OS 카메라 → 딥링크에 맡긴다(권한·의존성 최소화).
- 결정: 원격 bridge는 `ws://`(LAN/Tailscale)라 Android `usesCleartextTraffic` + `allowMixedContent`, iOS ATS `NSAllowsLocalNetworking`·`NSAllowsArbitraryLoadsInWebContent` 허용. 전송 내용은 ADR-018의 앱 계층 E2E 암호화로 보호된다.
- 결정: iOS는 웹뷰가 상태 바 아래까지 그려지므로(viewport-fit=cover) 루트·드로어·모바일 모달·전체화면 마인드맵에 `env(safe-area-inset-*)` 패딩. 데스크톱/웹은 inset 0이라 확정 UX 변화 없음.
- 결정: Tailwind v4는 vite 루트 기준으로 소스를 스캔하므로 ui `styles.css`에 `@source '.'` 추가(모바일 빌드 CSS가 ui와 동일 해시).
- 결정: Android WebView 검증은 Playwright `connectOverCDP`가 지원되지 않아 `adb forward` + CDP `Runtime.evaluate` 원시 호출로 수행. iOS는 Xcode 26.1 플랫폼 구성요소가 없어 `xcodebuild -downloadPlatform iOS`로 설치 후 빌드.
- 근거: 플랫폼 무관 core/ui 유지, 비밀 값은 OS 보안 저장소 규칙, 확정 UX 보존.

### ADR-020 · 2026-10-10 · relay: 투명 다중화 중계 · 자기 증명 등록 · 직접→relay 대체 (Phase 6)
- 결정: relay는 새 암호 계층을 두지 않고 기존 원격 프로토콜(ADR-018)을 그대로 실어 나르는 다중화 파이프. bridge 제어 소켓 하나에 클라이언트별 채널 번호(`open/data/close`)를 붙인다. bridge는 채널마다 가상 `PeerSocket`을 만들어 직접 연결과 같은 `accept()`로 처리 → 핸드셰이크·인증·검증 코드 공유, relay는 임시 공개키와 암호문만 본다.
- 결정: bridge 등록은 문서의 "등록 토큰" 대신 자기 증명 — relay가 준 nonce를 `sha256("branch-relay/1"‖nonce‖bridgeId)`로 묶어 bridge 신원 키로 서명, relay는 `keyId(key)==bridgeId`와 서명을 확인. 토큰 발급·보관이 필요 없고 bridgeId를 가로챌 수 없다. 같은 id 재등록 시 이전 소켓은 4409로 교체.
- 결정: bridge 없음 → 클라이언트 4404 닫기, 앱은 "bridge PC에서 --relay 옵션으로 실행 중인지" 안내. 채널 64개/bridge, maxPayload 4MB, 등록 10s 제한, 30s ping, `/health`. 페이로드·토큰은 로그에 남기지 않는다.
- 결정: 클라이언트는 `RemotePairing.relayUrl`(링크의 `r`)을 저장하고 직접(relay가 있으면 3s 제한) → relay 순으로 시도, 닿지 않음/시간 초과만 다음 후보로 넘어가며 거부·키 불일치는 즉시 실패(다운그레이드 방지). 성공 경로를 기억해 다음 연결에 먼저 시도. 상태 detail은 "Relay 경유".
- 결정: bridge CLI `--relay <url>`(직접 + relay), `--relay-only`(포트를 열지 않음 = NAT 뒤 실행). 재접속은 1s→30s 지수 백오프.
- 결정: packages/relay는 프로토콜 타입·서명 검증을 위해 @branch/core에 의존(문서의 "relay 독립"과 다름 — 프로토콜 정의를 한 곳에 두는 편이 안전).
- 결정: 오프라인 대체 provider는 기존 경로(remote-bridge `offline` → Composer "X로 전환" 배너, 오류 메시지 "X로 재시도", `fallbackOrder`)를 그대로 사용. relay에서 bridge가 빠지면 `offline`이 되는 것을 통합 테스트로 확인.
- 근거: 03-PROVIDERS Relay 설계, 비밀 값 relay 평문 금지 규칙, 브라우저 https 출처의 ws:// 차단(B-06)을 wss relay로 해소.

### ADR-021 · 2026-10-10 · 마무리: 단위 테스트 · Playwright E2E · README · electron-builder (Phase 7)
- 결정: 앵커 복원은 마크다운 기호를 지우는 미니 렌더러로 "선택 → 저장 → 재렌더 → 복원" 왕복을 모든 단어 경계 조합에 대해 검사하고, 시드 데이터의 모든 앵커를 검증한다(`anchor-restore.test.ts`). 맥락 구성은 3단계 트리 픽스처로 조상 앵커 체인 순서·앵커 이후 대화 제외·최근 N개·잘라내기·앵커 메시지 삭제·요청 턴 필터를 검사한다(`context-build.test.ts`).
- 결정: E2E는 실제 API 대신 저장소의 모의 Anthropic SSE 서버(`e2e/mock-anthropic.mjs`)를 쓴다. 시스템 프롬프트로 제목/요약/채팅 요청을 구분해 결정적인 응답을 주고, 키가 다르면 401을 준다. Playwright `webServer`가 모의 서버(:8799)와 전용 Vite(:5191, `VITE_ANTHROPIC_BASE_URL`)를 띄우므로 개발 서버(:5173)와 충돌하지 않는다. 브라우저 설치·실행 시간이 있어 `pnpm test`에 넣지 않고 `pnpm e2e`로 분리.
- 결정: E2E 범위 = 데스크톱(1440×900)·모바일(390×844 터치) × {잘못된 키 → 안내, 키 평문 미노출 / 루트 → 3단계 가지 → 요약 붙이기 → 새로고침 후 유지 / 데모 시나리오 8개 렌더}, 데스크톱 전용 {분할·마인드맵·Cmd+K 검색}. 페이지 오류 0을 함께 확인.
- 메모: 선택 메뉴는 메뉴를 누른 뒤 600ms 동안 선택 재평가를 건너뛴다(터치 오동작 방지). 자동화는 사람보다 빨라 이 구간에 걸리므로 E2E는 선택+`mouseup`을 `toPass`로 재시도한다. 실사용 버그 아님.
- 결정: 웹 배포 산출물은 별도 `apps/web` 패키지를 만들지 않고 `packages/ui` 정적 빌드(`packages/ui/dist`)를 그대로 쓴다(02-ARCHITECTURE의 apps/web = ui 정적 빌드와 동일한 산출물, 중복 패키지 제거).
- 결정: 데스크톱 패키징은 electron-builder(`apps/desktop/package.json`의 `build`). main/preload는 esbuild로 bridge·core까지 번들되어 있어 `node_modules`가 필요 없다 → `files: dist/**`(소스맵 제외), `npmRebuild: false`. 대상 mac dmg/zip, win nsis, linux AppImage/deb. 서명은 B-03 그대로(미서명 `--dir` 패키지 실행 확인). 아이콘은 기본값(전용 아이콘은 개선 항목 → ADR-022에서 추가).
- 결정: `pnpm bridge -- --pair`처럼 pnpm이 맨 앞 `--`를 그대로 넘겨 parseArgs가 옵션을 위치 인자로 처리하던 문제 → bridge/relay CLI에서 맨 앞 `--`를 무시.

### ADR-022 · 2026-10-10 · 개선: CI/릴리스 · 앱 내 QR 스캔 · 앱 아이콘 · 이해 노트 내보내기
- 결정(CI): `.github/workflows/ci.yml` — push(main)/PR에서 ubuntu 러너로 `pnpm typecheck`·`lint`·`test`와 `pnpm e2e`(Playwright chromium, 실패 시 trace 업로드)를 분리 실행. `release.yml` — 태그 `v*`/수동 실행에서 macOS·Windows·Linux 러너가 각 OS용 데스크톱 설치본(`pnpm --filter @branch/desktop package`)을, ubuntu가 Android debug APK를 만들고 태그일 때 초안 GitHub Release에 첨부. 서명은 secrets(`MAC_CSC_LINK` 등)가 있을 때만, 없으면 `CSC_IDENTITY_AUTO_DISCOVERY=false`로 미서명 빌드. 인증서는 저장소에 두지 않는다. actionlint 통과. 저장소에 git remote가 없어 실제 실행은 B-10.
- 결정(QR): ADR-019의 "OS 카메라 → 딥링크만"을 보완해 모바일 앱 페어링 링크 칸 옆에 [QR 스캔] 버튼 추가(`@capacitor/barcode-scanner`, QR 힌트). ui는 Capacitor에 의존하지 않고 `MobileApi.scanQr?()` 주입으로만 사용(ADR-019 유지) — 웹·데스크톱에는 버튼이 없다. 스캔 결과는 `parsePairingUri`로 검증 후 링크 칸만 채우고, 지문 확인·[연결]은 기존 흐름 그대로 사용자가 한다. 취소는 조용히 무시, 권한 거부는 안내. iOS `NSCameraUsageDescription`, Android `CAMERA`(카메라 하드웨어 필수 아님) 권한 추가.
- 결정: 바코드 스캐너 라이브러리가 Android minSdk 26을 요구 → `minSdkVersion` 24 → 26(Android 8.0+). `tools:overrideLibrary`로 강제하면 런타임 크래시 위험이 있어 택하지 않음.
- 결정(아이콘): 원본은 `assets/icon/glyph.svg`(줄기 = 대화, 가지 = 질문, 노란 노드 = 앵커 하이라이트, 배경 accent #2f7d62). `node scripts/gen-icons.mjs`가 Playwright Chromium으로 데스크톱 `apps/desktop/build/icon.png`(1024, macOS식 여백+둥근 사각 — electron-builder가 icns/ico 생성), iOS AppIcon 1024(꽉 찬 정사각), Android mipmap 5개 밀도(legacy/round/적응형 foreground + 배경색), 웹·모바일 `favicon.svg`·`apple-touch-icon.png`를 만든다. 추가 의존성(sharp, @capacitor/assets) 없이 기존 Playwright 재사용.
- 결정(이해 노트): core `notes.ts` 순수 함수 — `collectStudyCards`(DFS, 계층 번호 1.2.1, 경로, 앵커 주변 원문), `buildStudyNotes`(Markdown: 가지 제목 = 깊이별 헤딩, 원문 인용 속 앵커 굵게, "이해한 내용" = 요약), `buildAnkiDeck`(Anki 가져오기 TSV: `#separator:tab`·`#html:true`·`#deck:`·`#tags column:3` 헤더, 앞면 = 앵커+문맥+경로, 뒷면 = 요약, 요약 있는 가지만, 칸 HTML 이스케이프·탭/줄바꿈 제거). PRD의 "퀴즈/플래시카드·간격 반복은 범위 밖"은 유지 — 앱 안에서 복습 기능을 만들지 않고 Anki 등 외부 도구로 내보내기만 한다.
- 결정: 상단 바에 [이해 노트] 아이콘(루트가 있을 때만) → 모달(모바일 전체화면)에서 카드 목록·[Markdown 저장]·[Anki 카드]·[복사]. 카드를 누르면 그 가지를 연다. 파일 저장은 `saveTextFile`로 통일 — 웹/데스크톱은 다운로드, 모바일은 `MobileApi.saveFile?`(Filesystem 캐시 + 공유 시트). 백업 JSON 내보내기도 같은 경로를 써서 모바일에서도 파일로 저장된다.
- 근거: 확정 UX(04-UX-SPEC)의 기존 화면·흐름은 바꾸지 않고 진입점(아이콘·버튼)만 추가. 비밀 값 규칙 유지(스캔한 페어링 링크는 로그에 남기지 않음, CI 서명 정보는 GitHub secrets).

### ADR-023 · 2026-10-12 · 개선: CLI 모델·노력치 선택 (설정 기본값 + 채팅별 변경)
- 결정: Claude CLI·Codex CLI 모두 모델과 노력치(effort)를 고를 수 있다. 설정 › 연결의 CLI 카드에서 기본값(`ConnectionState.model`/`effort`, 영구 저장)을, 채팅 입력창 아래 칩 2개(모델·노력치)에서 대화별 덮어쓰기(`Session.modelPref = {providerId, model?, effort?}`)를 정한다. 적용 순서: 세션 덮어쓰기 → 연결 기본값 → CLI 자체 기본. core `cli-options.ts`의 순수 함수 `resolveModelOptions`로 계산.
- 결정: `modelPref`는 provider에 묶인다. 세션의 실제 provider와 `providerId`가 다르면 무시하고, 세션 provider를 바꾸면 지운다(모델 이름은 provider마다 달라서). 가지는 부모의 `modelPref`를 상속한다. 제목·요약 요청도 같은 옵션을 쓴다.
- 결정(CLI 인자): claude `--model <이름> --effort <low|medium|high|xhigh|max>`, codex exec `-m <이름> -c model_reasoning_effort="<수준>"` (codex는 `ultra` 추가, `gpt-6-luna`·`gpt-5.6-luna`는 ultra 없음). 모델이 지원하지 않는 노력치는 보내지 않는다.
- 결정(프리셋): Claude = fable/opus/sonnet/haiku 별칭, Codex = gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna. 설정에서 [직접 입력…]으로 다른 이름도 쓸 수 있다(`isValidModelName`: 영숫자 시작, `\w.:/-[]`, 80자 이하 — `-`로 시작하는 인자 주입 차단).
- 결정(검증): bridge가 CLI 인자로 넘기기 전 다시 검증한다. IPC 경로(`cliModelOptions`)는 잘못된 값을 버리고 기본값으로 실행, 원격 경로(`validateClientMsg`)는 메시지 전체를 거부한다. 셸을 거치지 않는 spawn 인자 배열이라 따옴표 주입도 없다.
- 근거: 확정 UX의 화면 구조는 유지하고 컨트롤만 추가(칩은 CLI provider일 때만 표시, 모바일 390px에서 한 줄). 정책 원칙 유지 — 공식 CLI의 공개 옵션만 사용.

### ADR-024 · 2026-10-12 · Android release 서명
- 결정: `apps/mobile/android/app/build.gradle`의 release 서명은 환경변수(`RHYMEBOOK_KEYSTORE`, `RHYMEBOOK_KEYSTORE_PASSWORD` 또는 `RHYMEBOOK_KEYSTORE_PASSWORD_FILE`, `RHYMEBOOK_KEY_ALIAS`)를 먼저 보고, 없으면 로컬 `~/rhymebook-release.jks` + `~/.rhymebook-keystore-pass`를 쓴다. 키가 없으면 서명 없이 빌드(기존 흐름 유지). 키·비밀번호는 저장소에 두지 않는다. PKCS12, alias `rhymebook`, 키/저장소 비밀번호 동일.
- 결정: `pnpm --filter @branch/mobile build:android:release` = 서명된 APK + AAB(Play 업로드용). `release.yml`은 secrets `ANDROID_KEYSTORE_BASE64`·`ANDROID_KEYSTORE_PASSWORD`가 있으면 release APK/AAB, 없으면 debug APK를 첨부한다. 디코딩한 키는 `$RUNNER_TEMP`에 두고 빌드 후 삭제.
- 메모: 키를 잃으면 같은 applicationId로 업데이트를 낼 수 없다 → 키 파일과 비밀번호 파일을 함께 별도 백업. Play 배포 시 업데이트마다 `versionCode` 증가 필요.

### ADR-025 · 2026-10-12 · 플랫폼별 연결 UI 분기 (PC / 웹·모바일) + PC 원격 페어링 열기 + 첫 실행 안내
- 배경: 사용자 요청 — PC에서만 CLI 에이전트를 쓰고, 웹·모바일은 API 키 등록과 PC 원격 페어링 연결만. PC는 "원격 페어링 열기"와 "다른 PC에 직접 연결" 둘 다. 웹·모바일 초기 설정에서는 모델 선택 등을 막는다. 확정 UX(04)의 설정·첫 실행 부분을 사용자 요청으로 개편.
- 결정(능력): core `platform.ts`의 `platformCaps(kind)` — desktop `{localCli, hostPairing, modelChoice}` 모두 true, web·mobile은 모두 false. 보여 줄 provider도 플랫폼별(`providers`): PC = CLI 2 · API 2 · 원격 Bridge · 데모, 웹·모바일 = 원격 Bridge · API 2 · 데모. ui `app/capabilities.ts`가 런타임(`branchDesktop`/`branchMobile`)으로 판별(개발 서버에서만 `?platform=` 화면 미리보기).
- 결정(웹·모바일 CLI 제거): 원격 bridge 경유 claude-cli/codex-cli provider(`includeCli`)를 쓰지 않는다. PC의 CLI는 "원격 Bridge" 하나로만 쓰고, 어떤 CLI·모델·노력치를 쓸지는 PC가 정한다. 저장·복원된 설정의 기본 provider·대체 순서는 `sanitizeSettings`로 플랫폼에 맞추고, 모델을 고를 수 없는 플랫폼에서는 연결별 모델·노력치 지정을 지운다. 채팅의 모델·노력치 칩과 API 카드의 모델 입력은 숨기고 기본 모델을 읽기 전용으로 보여 준다.
- 결정(호스트 정책): bridge `createRemoteServer({policy})` → `applyHostPolicy`가 원격 `chat.start`의 에이전트를 PC 설정(`settings.hostAgent`: 자동/Claude/Codex)으로 바꾸고, 원격이 보낸 모델·노력치는 버리고 PC의 CLI 카드 기본값으로 덮어쓴다(검증 통과 값만). 헤드리스 `npx @branch/bridge`는 정책 없음(기존 동작).
- 결정(PC 원격 페어링 열기): 데스크톱 main의 `host.ts`가 앱 안에서 원격 bridge 서버를 연다(별도 `createBridgeServer`, 신원 키·기기 목록 `userData/bridge-host` 0600, 설정 `host.json`). 포트는 저장된 포트 → 7777~7787 → 임의. 켜짐 상태는 재시작 후 복원. [휴대폰·웹 연결 (QR)]은 페어링 세션을 열고 주소(Tailscale/LAN/Relay, 로컬 제외)별 QR(SVG, `qrcode`)·6자리 코드·만료 카운트다운을 보여 준다. QR은 `img data:`로만 렌더(innerHTML 없음). 토큰·코드는 화면에만, 로그·저장 없음. 기기 목록(접속 여부)·개별/전체 해제, 고급 relay 주소(ws/wss 검증). IPC `host:*`.
- 결정(설정 › 연결 구성): PC = 이 PC의 에이전트(CLI) · API 키 · 원격 페어링 열기 · 다른 PC에 연결 · 데모 · 정책. 웹·모바일 = 내 PC 연결(원격 페어링, 맨 위) · API 키 · 데모 · 정책(플랫폼별 문구). 카드는 `settings/connectionCards.tsx`로 분리해 첫 실행 안내와 공유.
- 결정(첫 실행 안내): 실제 모드에서 `settings.setupDone`이 없고, 감지가 끝났는데 쓸 수 있는(데모 제외) 연결이 없으면 모달을 띄운다. PC = [이 PC의 CLI (추천)] / [API 키] + 원격 페어링 열기 안내, 웹·모바일 = [내 PC와 페어링 (추천)] / [API 키] — 모델 선택 단계 없음. 선택하면 같은 연결 카드를 그 자리에서 보여 주고, [시작하기](연결 준비 시)·[나중에 하기]로 끝낸다(기본 provider가 준비 안 됐으면 준비된 첫 provider로). 이미 연결이 준비된 기존 사용자는 안내 없이 완료 처리. 딥링크 페어링을 받으면 안내를 닫고 설정이 처리.
- 근거: 정책 원칙 유지 — 구독은 사용자 본인 PC의 공식 CLI 실행으로만, 웹·모바일은 CLI를 실행할 수 없으므로 선택지 자체를 없애 혼란을 줄인다. 모델·노력치를 PC 한 곳에서만 정하면 원격 요청이 PC에 없는 모델을 고르는 실패도 없다.


### ADR-026 · 2026-10-12 · 웹·모바일 원격 전용 (PC 호스트 스토어 동기화)
- 배경: 사용자 요청 — 웹·모바일은 CLI 경유 provider가 아니라 PC에 페어링해 PC에서 학습 중인 내용을 보고, 질문은 신호로 보내 PC가 CLI를 실행하게. UI/UX도 원격 전용으로 개편. ADR-025의 웹·모바일 API 키·원격 Bridge provider 구성을 대체(04 UX의 웹·모바일 연결·설정·첫 실행 부분 개편).
- 결정(진실 원천): PC 데스크톱 renderer 스토어(Dexie)가 유일한 데이터 원천. 웹·모바일 스토어는 메모리 전용 미러이며 보기 상태(분할·팝업·시트)와 테마만 로컬.
- 결정(프로토콜): core `bridge/sync.ts` — `sync.hello`→`sync.snapshot`(세션·스트리밍·요약 초안), 세션별 지연 로드 `sync.messages`, 변경 push(`sync.session/message/streaming/draft`), 액션 `act{op}`→`act.result`. id는 클라이언트가 생성(낙관적 표시). 같은 E2E 암호화 채널, 엄격 검증. 스트리밍 push는 throttle.
- 결정(경로): bridge RemoteServer가 sync 메시지를 데스크톱 main에 넘기고, main은 IPC로 renderer의 호스트 엔진(core `createSyncHost`)에 중계. 엔진 미준비 시 `sync.error`, 준비되면 `sync.reset`. macOS에서 호스트가 켜져 있으면 창 닫기 = 숨기기. 헤드리스 bridge는 sync 미지원(`sync.error` 안내).
- 결정(정책): 원격이 만든 루트 세션은 PC `hostAgent`(자동이 아니면)로 지정. 모델·노력치는 PC 연결 기본값. 기존 `chat.start` 경로와 호스트 정책은 데스크톱의 "다른 PC에 연결"용으로 유지.
- 결정(웹·모바일 UI): API 키·로컬 저장·백업·모델 선택·provider 기본값 설정 제거. 미페어링 첫 화면 = 페어링 안내, 상단 PC 연결 상태 칩, 오프라인 배너 + 입력 비활성, 설정 = 연결된 PC(이름·지문·경로·해제) + 화면(테마·앵커 열기 위치). 데모 모드와 개발 서버 `?platform=desktop`(로컬 모드)은 유지.
- 근거: 학습 데이터를 PC 한 곳에 모아 기기 간 일관성 확보, 구독 CLI는 사용자 PC에서만 실행(정책 원칙), 모바일에 비밀 키를 두지 않는다.
- 진행 기록(테스트 소유권): T2의 실제 ws 동기화 테스트 요청이 3회 연속 형식만 있는 테스트(`expect(true)` 등)로 돌아와, 규칙(같은 실패 3회 → 대안)에 따라 리더가 `packages/bridge/test/remote.test.ts`의 동기화 테스트를 직접 작성했다(실제 기기 2대 페어링 · peerId 분리 · 개별/브로드캐스트 전송 · 형식 오류 act → `act.result(invalid)` · 연결 종료/해제 시 `peerGone`). 형식 오류 act는 클라이언트가 결과를 기다리므로 서버가 조용히 버리지 않고 실패로 응답하도록 함께 고쳤다.
- 진행 기록(T1 소유권): core 구현 에이전트의 sync client가 리뷰에서 반려(타임아웃 롤백 누락·오프라인 낙관 표시 잔존·삭제 후 보기 정리 누락)되어 에이전트를 중단하고 리더가 `packages/core/src/sync/{client,host}.ts`와 `test/sync.test.ts`를 넘겨받아 재작성했다. 테스트는 실제 데모 provider로 PC 스토어를 돌리는 호스트↔클라이언트 왕복(질문→스트리밍 수렴, 가지, 미로드 세션 push 차단, busy·forbidden·rate-limit·not-ready·conflict 거절과 롤백, 오프라인 즉시 실패, 타임아웃 재동기화, 끊김→자동 재연결, reset, peerGone, append offset 불일치 재요청, 요약)을 검증한다.
- 결정(자동 에이전트): PC '원격 요청 에이전트'가 자동이면 준비된 CLI(Claude → Codex 순)로 루트 세션을 만들고, 둘 다 없을 때만 PC 기본 provider를 쓴다. 실제 smoke에서 자동일 때 기본 provider(API, 키 없음)로 가 "Anthropic API 키가 설정되지 않았습니다"가 난 것을 고쳤다.
- 결정(삭제 동기화): 오프라인 중 PC에서 지워진 세션은 재연결 스냅샷에서 보기 상태를 정리하고, 활성 세션이었다면 남아 있는 가장 가까운 부모로 포커스를 옮긴다(독립 리뷰 지적, 회귀 테스트 추가).
- 한계(웹 페어링): 웹은 페어링 키를 탭 메모리에만 두므로(비밀 값 영속 저장 금지) 새로고침하면 다시 페어링해야 한다. 첫 화면에서 이를 안내한다. 모바일 앱은 보안 저장소에 둔다.
- 결정(앵커 검증): 호스트는 앵커 범위(offset 정수·메시지 길이 내)만 검사하고 `anchor.text`와 원문 slice의 일치는 검사하지 않는다 — 앵커 text는 마크다운이 제거된 렌더 텍스트라 원문 slice와 다를 수 있다.

### ADR-027 · 2026-10-12 · Windows CLI 실행 — 빈 인자 보존, Codex 에이전트 도구 끄기
- 배경: Windows에서 Claude CLI가 `error: option '--setting-sources <sources>' argument missing`으로 실패, Codex CLI는 응답이 매우 느림.
- 원인(Claude): win32는 npm `.cmd` 래퍼 때문에 `shell: true`로 실행하는데, `winQuote('')`가 빈 문자열을 그대로 둬 `--tools ''`·`--setting-sources ''`의 값이 cmd 명령줄에서 사라졌다.
- 결정: 빈 인자는 `""`로 넘긴다. Codex `-c` 값에는 따옴표를 넣지 않는다(`model_reasoning_effort=low` — TOML로 안 읽히면 문자열로 쓰임). win32 PATH에 `%USERPROFILE%\.local\bin`(claude 네이티브 설치)을 더한다.
- 결정(Codex): 대화에 쓰지 않는 에이전트 기능(shell_tool·unified_exec·apps·plugins·multi_agent·browser/computer use·web_search 등)을 `-c features.<name>=false`로 끈다. 모델이 셸 명령(win32는 PowerShell + 샌드박스)을 실행하거나 플러그인·앱을 띄우는 지연을 없애고, 입력 토큰을 약 25k → 19k로 줄인다. `--disable`은 모르는 기능 이름이면 실패하므로 버전 차이에 안전한 `-c`를 쓴다.
- 한계: `codex exec --json`은 토큰 단위 스트리밍이 없어 답이 완성될 때 한 번에 나온다. 남는 대기 시간은 대부분 모델 지연이라, 빠른 답이 필요하면 노력치 '낮음'이나 가벼운 모델을 고르도록 안내한다.

### ADR-028 · 2026-10-12 · 데스크톱 백그라운드 호스트 + 트레이
- 배경: 페어링된 기기는 PC renderer 스토어(ADR-026)에 의존하므로 창을 닫아 앱이 끝나면 원격이 끊긴다. 기존에는 macOS에서만 창 숨김.
- 결정: 원격 페어링(호스트)이 켜져 있으면 모든 OS에서 창 닫기 = 숨기기(renderer 엔진 유지, 백그라운드 throttling 끔). 호스트가 켜져 있는 동안 트레이(메뉴 막대) 아이콘을 띄우고 메뉴는 [열기]·상태 줄·[완전 종료]. 처음 숨길 때 한 번 "백그라운드에서 계속 실행 중" 알림. macOS는 창이 숨겨져 있으면 Dock 아이콘을 숨긴다. ⌘Q·트레이 [완전 종료]는 실제 종료.
- 대안: 렌더러 없는 main 단독 엔진 — 스토어·provider 로직이 renderer(Dexie)에 있어 대규모 이동 필요. 기각.

### ADR-029 · 2026-10-12 · 서식·메모 = Annotation 엔티티
- 결정: 드래그 메뉴의 형광펜·밑줄·글자색·글꼴·굵게·기울임·메모는 메시지 원문 offset(가지 Anchor와 같은 규칙)에 붙는 `Annotation`으로 저장한다(Dexie v3 `annotations`, 백업 선택 필드, sync op `annot.set`/`annot.delete` + push `sync.annot`). 메시지 content는 바꾸지 않는다(답변 원문 보존, 맥락 구성에 영향 없음).
- 렌더: rehypeAnchors가 가지·annotation 경계를 함께 잘라 `span.annot` 안에 `mark.anchor`를 둔다. 표시 아이콘은 CSS pseudo-content라 DOM 텍스트 = 렌더 텍스트가 유지된다.
- 같은 범위를 다시 서식하면 기존 annotation을 갱신, 겹치는 다른 범위는 새로 만든다. [서식 지우기]는 선택과 겹치는 annotation의 서식을 지운다(메모는 유지).
- 원격: 클라이언트는 낙관적으로 적용하고 op 실패(오프라인·전송 실패·시간 초과·호스트 거부) 시 아직 그 값 그대로일 때만 이전 값으로 되돌린다. 호스트는 assistant 메시지·`endOffset ≤ content.length`를 검증한다.
- 서식 버튼은 메뉴를 닫지 않아 연속 적용할 수 있다. 데스크톱은 메뉴 조작 직후 선택을 다시 읽어 메뉴를 현재 선택에 맞춘다.

### ADR-030 · 2026-10-12 · 여러 블록 가지 = 왼쪽 영역 막대
- 결정: 가지 앵커가 2개 이상 블록 요소(문단·목록 항목·제목·코드·인용·표 칸)에 걸치면 본문 배경 하이라이트 대신 메시지 왼쪽 여백의 세로 막대로 표시한다. 텍스트 mark는 남겨 두되(`data-region`, 배경 없음) hover·클릭·스크롤 이동에 쓴다. 막대는 mark 사각형의 세로 합집합으로 측정, 겹치면 lane으로 나란히 둔다.

### ADR-031 · 2026-10-12 · 원격 기기의 세션별 에이전트·모델·노력치 선택 (ADR-025·026 일부 대체)
- 배경: 사용자 요청 — 모바일 앱에서도 provider·모델·노력치를 바꾸고 싶다. 기존에는 원격 요청의 CLI·모델을 PC 설정만 정했다.
- 결정: sync op `session.agent { sessionId, providerId?, model?, effort? }` 추가. 있는 키만 바꾸고 `null`은 PC 기본값. providerId는 PC의 공식 CLI(`claude-cli`·`codex-cli`)만 허용(API 키 provider는 원격에서 고를 수 없음). 호스트는 PC 스토어의 `setSessionProvider`/`setSessionModel`을 그대로 써서, CLI를 바꾸면 이전 모델 덮어쓰기를 버리고 모델에 맞지 않는 노력치를 버린다. 모델 이름은 `isValidModelName`, 노력치는 소문자 토큰만 통과(인자 주입 방지는 bridge가 다시 검증).
- UI: 원격(웹·모바일) 세션 헤더에 [에이전트·모델] 칩 → 에이전트/모델/노력치 선택 팝오버. 에이전트를 고르기 전(PC 기본)에는 모델·노력치를 잠근다(어느 CLI의 값인지 모호).
- 유지: 구독은 여전히 사용자 PC의 공식 CLI 실행으로만 쓰인다(정책 원칙 불변). `chat.start` 경로(다른 PC에 연결)의 호스트 정책 덮어쓰기는 그대로.

### ADR-032 · 2026-10-12 · 가지 표시 테마색·드래그 메뉴 배치·사용자 지정 서식 색·데모 UI 제거
- 가지 표시: `--anchor*` 토큰을 테마색(accent) 계열로 바꾸고, 각 가지 범위의 끝 조각(`data-branch-end`)에 CSS 마스크 가지 아이콘을 붙인다(DOM 텍스트 불변). 메모 아이콘은 `--note`(호박색)로 분리해 가지와 구분한다.
- 드래그 메뉴: 실제 크기를 재서 선택을 가리지 않는 자리(위 → 아래 → 오른쪽 → 왼쪽, 모두 안 되면 덜 걸친 화면 가장자리)에 둔다(`placeMenu`). 모바일 하단 바가 선택을 가리면 위쪽으로 올린다. PC·웹은 설정에서 [드래그하면 자동]/[우클릭으로 열기]를 고른다(기기별 localStorage, 모바일 앱·모바일 폭은 항상 자동).
- 서식 색: `MarkColor = 추천 색 이름 | 소문자 #rrggbb`. 렌더는 `data-*="custom"` + 인라인 CSS 변수(`--hl/--ul/--tc`). sync 검증은 `isMarkColor`. 형광펜·밑줄·글자색 버튼마다 색상표(즐겨찾기·추천·사용자 지정·없음)를 연다. 즐겨찾기는 기기별 localStorage(최대 12).
- 데모 UI 제거: 개발 서버 상단 데모 바, 설정의 데모(Mock) 카드, provider 목록의 Mock을 없앤다. `#scenario=<id>` 해시 실행만 화면 없는 개발 전용 훅으로 남긴다(E2E·스크린샷).
- 원문 접기: 가지 헤더의 provider 오른쪽 토글로 부모 원문 인용·요약 버튼 줄을 완전히 숨긴다(요약은 헤더 아이콘으로). 기기별 저장.

### ADR-033 · 2026-10-13 · 메시지 첨부(사진·파일·붙여넣은 긴 텍스트)
- 배경: 사용자 요청 — 입력창 앞 + 버튼으로 사진·파일 첨부, 클립보드 이미지 첨부, 첨부·긴 붙여넣기 텍스트는 입력창 위 미리보기.
- 결정: `Message.attachments?: Attachment[]` (`kind: image | pdf | text`, image·pdf는 base64, text는 UTF-8 원문, 붙여넣기는 `pasted: true`). 지원 형식: PNG·JPEG·GIF·WebP, PDF, 텍스트·코드 파일. 그 밖의 형식은 안내 후 거부. 이미지는 UI가 긴 변 1600px·JPEG로 줄인다(작으면 원본).
- 제한: 메시지당 10개, 파일당 5MB, 합계 6MB. 원격 WebSocket 프레임 한도를 4MB → 16MB(`REMOTE_MAX_PAYLOAD`, bridge·relay 공통)로 올려 base64 + E2E 암호화 후에도 메시지 하나가 들어가게 했다.
- 맥락: `toTurns`가 텍스트 첨부를 `<attachment name=…>` 블록으로 본문 앞에 붙이고, 이미지·PDF는 `ChatTurn.attachments`로 넘긴다. Anthropic = image/document 블록, OpenAI = image_url(data URL)·file 파트, Claude CLI = `--input-format stream-json`으로 content 블록을 담은 사용자 메시지 한 줄(실제 CLI 2.1.296에서 이미지 인식 확인), Codex CLI = `exec --image <임시 파일>`(실제 0.154.0 확인, PDF는 이름만 알림).
- 검증: sync op `send`에 `attachments`·`skill` 추가, `isAttachmentList`로 형식·크기 확인(키 화이트리스트). 원격 `chat.start`도 같은 검증.
- 길게 붙여넣기 기준: 1,200자 또는 25줄 이상 → 텍스트 첨부 미리보기. 짧은 붙여넣기는 그대로 입력.

### ADR-034 · 2026-10-13 · 스킬(슬래시 명령·+ 메뉴) 관리
- 결정: `Skill { id, name(슬래시 명령), title, description, prompt }`를 기기별 IndexedDB(Dexie v4 `skills`)에 둔다(원격 모드 웹·모바일도 그 기기에). 질문을 보낼 때 고른 스킬의 사본(`SkillRef`)을 사용자 메시지에 싣고, `buildChatRequest`가 **마지막 질문**의 스킬 지시만 system에 붙인다(다음 질문에는 붙지 않음). 사본이라 스킬을 고치거나 지워도 지난 대화·재시도·PC(원격)에서 같은 지시가 쓰인다.
- 호출: 입력창 `/`로 시작하면 후보 목록(↑↓·Enter·Tab·Esc), 또는 + 메뉴 › 스킬. 고르면 입력창 위 스킬 칩. `/명령 나머지`를 그대로 보내도 적용된다(모르는 명령은 일반 텍스트). 이름 규칙: 영문 소문자·숫자·한글·-·_ 32자.
- 관리: 별도 전체 화면 페이지(사이드바 [스킬 관리], + 메뉴 [스킬 관리…]). 처음 실행 시 예시 스킬 **커리큘럼 생성**(`/curriculum`)을 한 번 넣고, 지우면 다시 넣지 않는다(빈 목록에서 [예시 스킬 다시 넣기]).
- 범위 밖(후속): 스킬 백업·기기 간 동기화.

### ADR-035 · 2026-10-13 · 상단 보기 전환 제거, 사이드바 끌어 놓기로 좌우·상하 분할
- 배경: 사용자 요청 — 상단 단일/분할 버튼을 없애고 마인드맵만 유지, 좌측 패널에서 끌어 분할로 열기, 좌우·상하 모두.
- 결정: `ViewState.splitLayout?: SplitNode`(잎 = 세션, 그룹 = `row`(좌우)|`col`(상하) + 비율) 배치 트리. `splitSessionIds`는 잎 순서로 항상 맞춘다(`fixSplit`). 패널 최대 4(`MAX_SPLIT` 3 → 4). 같은 방향 그룹은 펼치고, 자식 하나 그룹은 푼다. 패널이 하나 이하가 되면 단일 보기로 돌아간다. 저장된 이전 `splitSizes`(좌우 비율)는 복원 시 배치 트리로 옮긴다.
- UI: 데스크톱·태블릿 사이드바 세션 행을 끌면 패널마다 놓기 영역이 뜬다. 가장자리 28% 안 = 그 방향으로 새 칸, 가운데 = 그 패널 교체(이미 분할에 있는 세션이면 자리 이동·맞바꿈). 가득 차면 가운데만 허용(새 칸은 안내 토스트). 끄는 동안 가지 팝업은 흐리게·통과. 세션 우클릭 메뉴에 [오른쪽에/아래에 분할로 열기]. 상단 바는 [마인드맵] 토글 하나(끄면 분할이 있으면 분할, 없으면 단일).
- 유지: 모바일(<768)은 분할 = 탭, 끌기 없음. 앵커 열기 위치 설정의 '분할 패널'·팝업 [분할로 도킹]·마인드맵 Shift+클릭은 포커스 패널 오른쪽에 붙인다(가득 차면 마지막 패널 교체).

### ADR-036 · 2026-10-13 · 세션 별도 창(데스크톱), 분할창 자리 이동·스왑, 수식(KaTeX)
- 배경: 사용자 요청(IMP-10) — 좌측 패널 우클릭 [새 창으로 열기](같은 세션이 떠 있어도 새 창, 중복 허용)·가지 삭제, `$$` 수식, 분할창 위치 이동·경계선 ⋯ 스왑(갤럭시 탭 화면 분할 참고).
- 새 창 결정: 세션 창은 저장소를 갖지 않고 메인 창(동기화 엔진)을 **로컬 SyncClient**로 미러링한다(ADR-026 프로토콜 재사용). main 프로세스가 세션 창을 `?window=session&session=<id>`로 열고, `win:sync-out/in` IPC를 엔진 창 SyncHost의 피어 `win-<webContentsId>`로 중계한다. 두 창이 같은 IndexedDB에 따로 쓰는 경쟁이 없고 상태가 항상 일치하며, CLI 실행은 엔진 창 하나가 한다. 세션 창 피어는 원격 삭제 설정과 무관하게 삭제 허용·토스트 없음. 세션 창이 열려 있는 동안 엔진 창 백그라운드 스로틀링을 끈다. 메인 창을 닫으면(백그라운드 호스트가 아니면) 세션 창도 닫는다. 엔진 새로고침 중에는 `sync.error not-ready` → 세션 창이 재연결.
- 대안(기각): 창마다 독립 스토어 + BroadcastChannel 변경 알림 — 같은 레코드 이중 쓰기·스트리밍 중 불일치.
- 분할: core `swapLeaves`·`neighborOf`(배치 기하 기준 이웃)·`swapChildren`·`flipGroupDir` + 스토어 `swapSplit`·`swapSplitChildren`·`flipSplitGroup`. 맞바꿀 때 칸 비율은 위치에 남는다. 패널 헤더 [자리 이동] 메뉴(왼/오/위/아래와 바꾸기), 경계선 가운데 ⋯ → [자리 바꾸기]·[방향 전환]. ⋯ 버튼은 경계선 끌기와 충돌하지 않게 캡처 단계에서 pointerdown을 막는다.
- 수식: remark-math + rehype-katex. `\[…\]`·`\(…\)`는 **같은 길이**로 `$$`·`$ ` 치환(앵커 원문 offset 보존, 코드 안 제외). 앵커 맵은 `.katex-mathml` 숨김 텍스트를 빼고, 수식은 쪼개지 않고 통째로 감싼다. 한계: `$5 and $10` 같은 문장은 인라인 수식으로 해석될 수 있다.

### ADR-037 · 2026-10-13 · AI로 스킬 만들기·고치기
- 배경: 사용자 요청 — 스킬 생성·수정을 AI로 할 수 있게 UI/UX 개선.
- 결정: 스킬 편집 칸 위에 **AI 도우미** 칸을 둔다. 편집 칸이 비어 있으면 [AI로 만들기], 내용이 있으면 [AI로 고치기]. 원하는 것을 적고 Enter(또는 빠른 요청 칩: 새 스킬 예시 4개 / 고치기 4개). 진입점: 입력창 + 메뉴 [AI로 스킬 만들기…](새 스킬 + AI 칸 포커스), 스킬 관리의 [새 스킬](AI 칸 포커스).
- 형식: core `skillAssist.ts` — `buildSkillAssistRequest`(현재 스킬·다른 명령 이름·요청, `purpose: 'skill'`), 모델은 `<name>/<title>/<description>/<prompt>/<note>` 태그로만 답한다. `parseSkillAssist(raw, partial)`는 코드 블록·앞뒤 말·닫는 태그 누락을 견디고, 스트리밍 중에는 닫히지 않은 태그도 지금까지만큼 돌려줘 편집 칸이 실시간으로 채워진다. `finalizeSkillAssist`가 빠진 필드는 현재 값으로, 이름 충돌은 `-2…`(`uniqueSkillName`), 길이는 제한에 맞춘다.
- 저장: AI 결과는 편집 칸에만 채우고 저장은 사용자가 한다. 완료 후 [AI 변경 취소]로 요청 전 내용으로 되돌린다. 작성 중에는 편집 칸·저장을 잠그고 [중지]하면 원래 내용으로 돌아간다.
- provider: 설정 기본 provider, 준비되지 않았으면 대체 순서에서 준비된 것(칸 오른쪽에 표시). 웹·모바일은 원격 Bridge(PC CLI) 그대로. `purpose: 'skill'`은 채팅과 같은 출력 한도(4096).
### ADR-038 · 2026-10-14 · 스킬 부수 파일·스킬 폴더·스킬 전용 provider/모델/노력치
- 배경: 사용자 요청 — Claude·Codex 스킬처럼 reference·스크립트 등 파일을 두고 스킬 폴더를 열어 확인, AI 작성 시 부수 파일도 생성, 스킬마다 전용 provider·모델·노력치(미설정이면 세션 설정).
- 모델: `Skill.files?: SkillFile[]`(상대 경로 + 텍스트), `Skill.options?: { providerId; model?; effort? }`. `SkillRef`(메시지 사본·동기화)에도 같은 선택 필드. 파일 제한 30개·파일 40,000자·합계 120,000자, 경로는 `/`로 나눈 안전한 이름(깊이 4, `..`·숨김·`SKILL.md` 불가). 지시 한도 8,000→20,000자, 설명 200→1,024자(Claude SKILL.md 가져오기).
- 파일 사용: 도구 없는 CLI·API·원격 모두 같게 동작하도록 스킬을 쓴 질문의 system 프롬프트에 지시 뒤 `### 스킬 파일`로 경로별 코드 블록을 싣는다(`withSkill`). 스크립트는 실행하지 않고 내용·실행 방법을 안내하게 한다. 대안(CLI cwd를 스킬 폴더로 두고 읽기 도구 허용)은 API·원격에서 동작하지 않고 도구 권한을 넓혀 채택하지 않음.
- 폴더(데스크톱 메인 창): `<userData>/skills/<name>/SKILL.md`(frontmatter name·description + title·provider·model·effort) + 파일. IndexedDB가 기준이고 폴더는 거울: 앱에서 저장하면 폴더를 똑같이 맞추고(이름 변경 시 이전 폴더 삭제, 앱이 읽을 수 없는 바이너리·큰 파일·숨김 파일은 두고), 시작·창 포커스·스킬 관리 열 때 폴더를 읽어 바뀐 스킬은 고치고 앱에 없는 폴더(예: Claude 스킬 폴더 복사)는 새 스킬로 가져온다(`diffSkillFolders`). 편집 중(저장 안 함)이면 편집 칸은 그대로 둔다. main은 이름·경로·크기를 다시 검증하고 폴더 밖·심볼릭 링크로는 쓰지 않는다. frontmatter의 다른 키(allowed-tools 등)는 앱에서 다시 저장하면 빠진다.
- AI 도우미: `<file path="…">…</file>`·`<delete path="…"/>` 태그를 더했다. 필요할 때만 references/·scripts/·assets/에 만들고 지시에서 경로로 가리키게 한다. 고칠 때 기존 파일(파일당 6,000자까지)을 요청에 싣고, 출력하지 않은 파일은 유지(`mergeSkillFiles`).
- 실행 설정: `chatTarget` — 마지막 사용자 메시지의 스킬에 옵션이 있고 그 provider가 등록돼 있으면 그 턴만 스킬 설정(비운 모델·노력치는 그 provider 연결 기본값), 아니면 세션 설정. 제목·요약은 세션 설정. 실패 후 대체 provider로 다시 시도하면 스킬 설정을 무시한다. 원격 피어가 보낸 스킬 옵션은 PC CLI(claude·codex)일 때만 따르고(ADR-031과 같은 범위), 같은 PC 세션 창은 모두 따른다. 웹·모바일의 고급 옵션은 PC 에이전트만 고른다.
- 호환: 새 클라이언트가 파일·옵션이 있는 스킬을 이전 버전 PC로 보내면 PC 검증(키 엄격)에서 거절된다 — PC를 먼저 업데이트한다.

### ADR-040 · 2026-10-14 · `rhymebook serve` 헤드리스 호스트 (ADR-026 "헤드리스 bridge는 sync 미지원"·ADR-028 "렌더러 없는 호스트" 기각 일부 대체)
- 배경: 사용자 요청 — `rhymebook serve` 한 줄로 서버를 켜고 모바일 앱이 연결해 쓰게. 지금은 데스크톱 앱(트레이)만 호스트가 될 수 있다.
- 결정: 새 패키지 `packages/server`(bin `rhymebook`)가 Node 프로세스 안에서 core 스토어·sync host와 bridge 원격 서버를 조립한다. 렌더러 코드를 옮기지 않고 core에 이미 있는 순수 조각(`createAppStore`·`createRuntimeRegistry`·`createSyncHost`)과 bridge(`createBridgeServer`·`createRemoteServer({sync})`)만 쓴다. CLI provider는 같은 프로세스의 BridgeServer에 붙인 `createBridgeProviders`.
- 저장: 데스크톱 IndexedDB 대신 `<dir>/data.json`(core `StoredData`, 디바운스 원자적 쓰기, 0600). 데스크톱 앱과 데이터는 공유하지 않는다(별개 호스트). 페어링 정보는 `<dir>/bridge`. 기본 `<dir>` = `RHYMEBOOK_HOME` | XDG/APPDATA `rhymebook`.
- 스킬: `<dir>/skills/<name>/SKILL.md` 폴더를 읽기만 해 원격 `sync.skills`로 준다(데스크톱 `skillsDir`를 `@branch/bridge`로 옮겨 공유). 폴더가 없으면 core 기본 예시 스킬.
- 에이전트: `--agent auto|claude-cli|codex-cli`. auto면 준비된 claude-cli → codex-cli → (환경변수 키가 있으면) anthropic-api → openai-api. API 키는 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 환경변수를 메모리에만 둔다.
- 삭제: 원격 삭제 기본 허용(데스크톱 기본과 같음), `--no-delete`로 끈다.
- 대안: Electron을 화면 없이 띄우기 — 무겁고 서버(GUI 없는 리눅스)에서 못 씀. 렌더러 번들을 jsdom으로 돌리기 — IndexedDB·DOM 의존이 커서 기각.
- 이름: 처음 실행 때 컴퓨터 이름으로 정해 `bridge/identity.json`에 저장하고 `--name`을 줄 때만 바꾼다(스모크에서 재시작마다 덮이던 문제 수정).
- 첫 실행은 data.json을 즉시 저장해 곧바로 종료돼도 설정이 남는다.

### ADR-041 · 2026-10-14 · Codex 이미지 생성 켜기와 생성 이미지 첨부 (ADR-027 "Codex 기능 끄기" 일부 대체)
- 배경: 사용자 보고 — 맥 호스트에서 이미지 생성 스킬이 "도구 실행이 비활성화되어 이미지를 생성할 수 없습니다"로 실패. 원인은 ADR-027에서 끈 Codex 기능 목록에 `image_generation`이 들어 있었기 때문. 윈도우에서는 모델이 SVG로 대신 그렸다.
- 결정: 일반 대화(`purpose` 없음·`chat`)의 codex-cli 실행에만 `image_generation`을 켠다(core bridge client가 `chat.start.imageGen: true`). 제목·요약·스킬 작성에서는 계속 끈다. codex 0.162는 이미지 생성 도구를 code mode 호스트로 부르므로 `code_mode_host`도 함께 켠다(끄면 "code-mode host is disabled"로 실패해 모델이 "도구 실행 환경이 비활성화"라고 답한다 — 첫 수정 뒤에도 같은 오류가 난 원인). 다른 에이전트 도구(셸·exec·웹 등)는 그대로 끈 상태로 둔다. 켰을 때는 system 뒤에 지시를 덧붙인다: 이미지는 이미지 생성 도구로 만들고, 파일 경로를 말하지 않고, SVG로 대신 그리지 않는다.
- 수집: Codex는 생성 이미지를 `$CODEX_HOME(기본 ~/.codex)/generated_images/<thread_id>/`에 저장하고 JSON 이벤트로는 알리지 않는다. bridge는 `thread.started`의 thread_id를 기억했다가(형식 검증), 프로세스가 끝나면 그 폴더만 이름순으로 읽어 `chat.image`(첨부) → `chat.done` 순서로 보내고, 폴더를 지운다. 오류로 끝나도 지운다. 사용자가 직접 실행해 생긴 다른 thread 폴더는 건드리지 않는다.
- 크기: 생성 PNG는 장당 2~3MB여서, 1MB가 넘는 PNG는 JPEG(q90)로 다시 압축한다. 알파는 흰 배경에 합성하고, 결과가 더 크면 원본을 쓴다. 순수 JS인 pngjs·jpeg-js를 써서 네이티브 의존성이 없다. 메시지 첨부 한도(ATTACHMENT_LIMITS: 10장·장당 5MB·합계 6MB)를 넘는 이미지는 버리고, 그 수를 답변 끝에 알린다.
- 저장: 이미지는 답변 메시지의 `attachments`로 저장한다. 같은 경로로 원격(웹·모바일) 동기화된다. 답변에서는 크게(최대 높이 32rem) 보여 준다. 뷰어에는 [이미지 저장] 버튼이 있다(웹은 다운로드, 모바일은 공유 시트).
- 맥락: Anthropic API는 assistant 턴의 이미지를 받지 않는다. 그래서 다음 질문 맥락에서는 assistant 첨부를 빼고 `[이미지 N장을 만들어 보여 줌]` 메모로 대신한다.
- 대안: SVG 출력을 렌더링하기 — 진짜 이미지가 아니므로 기각. Codex 세션 rollout 파일에서 이미지 추출하기 — 내부 형식 의존이 커서 기각.

### ADR-042 · 2026-10-14 · 앱 복귀 시 1회 자동 재연결 (웹·모바일 `autoReconnect: false` 보완)
- 문제: 모바일 앱이 백그라운드에 다녀오면 OS가 WebSocket을 끊는다. 웹·모바일은 수동 [다시 연결]만 있어서, 앱을 다시 열 때마다 직접 눌러야 했다.
- 결정: sync client에 `resume({ fresh })`를 추가했다. 앱이 복귀하면(모바일은 Capacitor `appStateChange`, 웹은 `visibilitychange`) 호출한다.
  - offline이면 바로 한 번 다시 연결한다. online·connecting이면 5초 유예를 둔다. 백그라운드에서 죽은 연결의 끊김 알림은 복귀 직후에 도착하므로, 유예 안에 끊기면 한 번 다시 잇는다.
  - 60초 넘게 백그라운드에 있었으면 살아 보이는 연결도 버리고(`SyncLink.reset`) 새로 연결한다. OS가 소켓을 조용히 죽여 online으로 보이지만 응답이 없는 경우를 막는다.
  - 그 한 번이 실패하면 offline에 머물고 `resumeFailedAt`을 남긴다. UI는 토스트로 알리고, 이후에는 기존처럼 [다시 연결]로만 잇는다(반복 재시도 없음). 연결 중에는 상단 PC 칩에 스피너와 '연결 중'을 띄운다(모바일 compact 칩 포함).
- 함께 고침: 원격 링크 `reset()`이 버린 소켓의 닫힘 이벤트가 늦게 도착하면 새 연결 구독자에게까지 끊김으로 전달되던 경합. 이제 `reset()`이 끊김을 즉시 한 번 알리고, 버린 연결(이전 generation)의 닫힘은 무시한다.
- 대안: 자동 재연결 백오프를 다시 켜기 — 수동 재연결 결정(PROGRESS 2026-10-14)과 충돌해 기각. 프로토콜에 ping 추가하기 — 구버전 호스트와 호환되지 않아 기각.

### ADR-043 · 2026-10-15 · 학습 꾸러미(내보내기·가져오기)와 책으로 만들기 (ADR-022 이해 노트 확장)
- 배경: 사용자 요청 — 이해 노트에서 현재 학습을 다른 기기로 옮길 수 있게 내보내기(마크다운 묶음), 그리고 학습을 목차부터 구조적으로 분석해 책으로 엮는 내장 AI 스킬.
- 꾸러미: `<제목>-학습-YYYY-MM-DD.zip` = `<제목>/README.md`(목차·가져오는 법) + 세션마다 Markdown(`00 루트.md`, `01 가지.md`, `01.02 하위.md` …) + `study.json`(`app: 'rhymebook-study'`, `version: 1`, 트리의 세션·메시지·어노테이션). 사람이 읽는 것은 md, 가져오기는 `study.json`만 읽는다(zip 또는 json 단독). 순수 함수는 core `study.ts`(fflate).
- 검증: 루트에서 닿는 세션만, 모든 세션이 같은 rootId, 메시지·어노테이션은 꾸러미 세션에만, id 형식·첨부 한도, 압축 해제 64MB. 생성 중이던 메시지는 '중지됨'으로. 더 새 버전 파일은 'newer-version'으로 거절.
- 합치기: 세션 단위. 이 기기에 없으면 추가, 있으면 `updatedAt`이 더 최근인 쪽을 남긴다(이어서 학습). 이 기기에만 있는 가지는 그대로, 생성 중인 세션은 건너뛴다. 같은 id를 다른 학습(다른 rootId·다른 세션의 메시지)이 쓰면 conflict로 아무것도 바꾸지 않는다. 갱신한 세션은 꾸러미의 메시지·어노테이션으로 통째로 바꾼다.
- 원격(웹·모바일): 데이터가 PC에만 있으므로 새 sync op `study.import`로 PC에 보낸다. 클라이언트·호스트 양쪽에서 같은 검증, JSON 6MB 한도, 응답 대기 60초, 결과는 Promise(실패 토스트 대신 모달 안내). 이미 있는 세션을 덮어쓰는 가져오기는 PC의 원격 삭제 허용이 필요하다(아니면 'forbidden') — 덮어쓰기는 사실상 삭제이기 때문. 원격 내보내기·책 만들기는 트리 전체 메시지를 PC에서 먼저 받는다.
- 책으로 만들기: 내장 스킬 `/book`(책으로 만들기, `skill-book`)은 구조 분석 → 목차 → 장별 본문 순서로 쓰고, 길면 "계속"으로 이어 쓴다. [책으로 만들기]는 새 루트 세션 "📖 <제목>"을 만들어 학습 원문(트리 순서 질문·답변·가지 친 원문·요약, 12만 자 한도 — 넘으면 답변을 비례로 줄이고 안내문)을 텍스트 첨부로, `/book` 스킬을 붙여 보낸다.
- 내장 스킬 시드: 시드 기록을 `true`에서 id 목록으로 바꿨다(예전 `true` = curriculum). 새 내장 스킬은 기존 사용자에게도 한 번 들어가고, 지운 내장 스킬은 다시 넣지 않는다. 헤드리스 serve는 `skills-seeded.json`.
- UX 변경(UX-SPEC 고정 문서는 그대로 두고 여기 기록): 상단 이해 노트 버튼을 학습이 없을 때도 보인다 — 빈 기기에서 [학습 가져오기]만 있는 모달을 연다. 이해 노트 하단 첫 줄에 [책으로 만들기](주 버튼)·[학습 내보내기]·[학습 가져오기], 둘째 줄에 기존 [Markdown 저장]·[Anki 카드]·[복사].
- 대안: 백업 JSON(설정 › 백업)을 그대로 쓰기 — 전체 데이터라 학습 하나만 옮길 수 없고 사람이 읽을 수 없어 기각. md만 내보내고 md를 파싱해 가져오기 — 앵커·요약·id 왕복이 깨지기 쉬워 기각.
