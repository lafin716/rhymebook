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
