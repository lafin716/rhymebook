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

### ADR-044 · 2026-10-15 · 책 세션을 진짜 책 같은 PDF로 저장 (ADR-043 확장)
- 배경: 사용자 요청 — "책으로 내보내기는 pdf 형식으로 진짜 책처럼". `/book` 세션의 답변(Markdown)을 표지·차례·쪽 번호가 있는 책으로 만든다.
- 구조: core `book.ts`가 `/book` 세션의 답변을 모아(`collectBookAnswers`) `# 책 제목`·`## N장. 제목`·머리말/맺음말/용어 찾아보기를 나눈다(`parseBook`). ui `book/bookHtml.tsx`가 정적 HTML 한 장을 만든다(`renderToStaticMarkup`, 앱과 같은 remark/rehype + KaTeX·코드 강조, "**핵심 정리**"+목록은 상자로): 표지 → 속표지 → 차례 → 머리말 → 장마다 여는 쪽(CHAPTER 번호·제목·절 목록) + 본문 → 맺음말·용어 → 판권.
- 판형: A5(148×210mm), 양면(안쪽 여백 20mm·바깥 16mm), 명조 본문 10pt·고딕 제목, 쪽 번호는 바깥 아래. 장마다 이름 있는 쪽(`@page ch-N`)으로 왼쪽 머리글 = 책 제목, 오른쪽 = "N장 제목". 표지·속표지·차례·여는 쪽에는 쪽 번호·머리글을 두지 않는다. 본문은 양쪽 정렬 + 음절 단위 줄바꿈(`keep-all`이면 어절 사이가 크게 벌어져서).
- 데스크톱: main의 숨은 창(전용 partition, 샌드박스, file:/data:만 허용하는 webRequest, 권한·새 창·이동 거부)에서 Chromium `printToPDF`. 차례 쪽 번호는 2회 인쇄로 채운다 — 1차 PDF의 이름 있는 목적지(`<a href="#id">`가 만드는 /Dests·/Names)를 pdf-lib로 읽어 id → 쪽 번호를 얻고, 차례의 `.toc-pg`를 채운 뒤 2차 인쇄. 목적지를 못 읽으면 1차 PDF를 그대로 쓴다. 작업은 줄 세우고 90초 제한(넘으면 멈춘 인쇄 창을 바로 닫아 다음 작업과 겹치지 않게)·HTML 20MB 한도. 저장은 기존 파일 저장 대화상자(`<제목>.pdf`).
- 웹: 같은 HTML을 숨은 iframe에 넣어 브라우저 인쇄 창을 연다('PDF로 저장'). 차례 쪽 번호 칸은 숨긴다(채울 수 없음). 모바일: 인쇄용 HTML 파일을 공유 시트로 내보낸다(WebView 인쇄가 없어서).
- 보안: 책 HTML은 스크립트를 넣지 않고 CSP `default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data: file:; img-src data:; script-src 'none'`. 쪽 번호 채우기는 main의 `executeJavaScript`라 CSP와 무관하다. 머리글 문자열은 CSS 문자열로 이스케이프, `</style`도 이스케이프. KaTeX CSS는 앱에 로드된 규칙을 옮기고 글꼴 url은 절대 경로로.
- UX(UX-SPEC은 그대로, 여기 기록): `/book` 세션 헤더에 [책 PDF] 버튼(모바일은 아이콘만). 답변 생성 중에는 비활성.
- 스킬 프롬프트: `/book` 프롬프트에 제목·장 머리 형식을 고정했다. 이미 시드된 사용자 스킬은 덮어쓰지 않으므로(ADR-043), 파서는 예전 형식도 받아들인다(`## 1장 제목`·`## 제1장: 제목`, H1이 없으면 "책 제목:" 줄 → 세션 제목, 장 사이 알 수 없는 `##`는 직전 장에 붙임).
- 대안: pdf-lib/jsPDF로 직접 조판 — 한국어 글꼴 내장·줄바꿈·수식이 어려워 기각. Paged.js — 스크립트가 필요하고 Chromium 기본 인쇄로 margin box·이름 있는 쪽이 이미 되므로 기각. `break-before: right`(장을 오른쪽 쪽에서 시작) — Chromium 미지원이라 쓰지 않는다.

### ADR-045 · 2026-10-15 · 음성으로 질문하기 — PC 로컬 whisper.cpp 전사, 웹·모바일은 PC 설정을 따름
- 배경: 채팅 입력을 말로 하고 싶다. 무료 전사 도구가 필요하다. 구독 CLI(claude·codex)는 오디오 입력·전사 기능이 없고, 토큰을 꺼내 다른 API를 부르는 것은 정책(구독은 공식 CLI 실행으로만)에 어긋난다.
- 결정: **whisper.cpp `whisper-cli`를 PC에서 로컬로 실행**한다(무료·오프라인, 녹음이 PC 밖으로 나가지 않음). 녹음마다 `-m 모델 -f wav -l ko -nt -np -t N`으로 한 번 실행하고, 전사는 한 번에 하나만 한다(GPU·메모리).
  - 모델 카탈로그(core `STT_MODELS`, Hugging Face `ggerganov/whisper.cpp` 공식 ggml): 기본 `large-v3-turbo-q5_0`(약 574MB, 정확), 가벼운 `small-q5_1`(약 190MB, 저사양). 받기는 `<userData>/stt/models/*.part` → 크기·sha256 확인 → rename. 진행률·취소·지우기 지원. 설정은 `<userData>/stt/settings.json`(`enabled`, `model`), 기본은 꺼짐.
  - 엔진 위치: 앱 번들 `Contents/Resources/whisper/whisper-cli`(electron-builder `extraResources`, `apps/desktop/scripts/build-whisper.mjs`로 v1.9.5 정적 Metal 빌드, `vendor/`는 gitignore) → `BRANCH_WHISPER_CLI` → PATH·`/opt/homebrew/bin`(`brew install whisper-cpp`). 없으면 설정에 설치 안내.
  - 프로토콜(bridge): `stt.status.get` → `stt.status{enabled,ready,detail}`, `stt.transcribe{audio: base64 WAV}` → `stt.result{text}`/`stt.error`. 원격 기기는 이 둘만 할 수 있고 켜기·모델·받기·지우기는 데스크톱 IPC(`DesktopApi.stt`)만. 내장 bridge와 원격 호스트 bridge가 같은 엔진을 공유한다. 헤드리스 server는 STT 미지원(응답 없음 → 마이크 숨김).
  - 오디오: 클라이언트가 녹음 → mono → 16kHz 리샘플 → PCM16 WAV. 최대 60초(≈1.9MB, base64 한도로 검사), bridge가 WAV 헤더(16kHz·mono·PCM16)를 다시 확인한다. 전사 제한 시간 120초.
  - 무음 차단: whisper는 무음에서 "고맙습니다"·"시청해 주셔서 감사합니다" 같은 문구를 지어낸다. 보내기 전에 30ms 구간 RMS가 하나도 문턱(0.003, 약 -50dBFS)을 넘지 않으면 보내지 않고 "들린 소리가 없어요"를 보여 준다. 결과에서도 소리 표기(`[음악]`·`(박수)`)와 흔한 환각 문구를 지운다.
  - 웹·모바일은 PC를 따른다: 마운트·화면 복귀·30초마다 `stt.status`를 물어 `ready`일 때만 입력창에 마이크 버튼을 보인다. 예전 PC(메시지 모름)는 응답이 없어 시간 초과 → 마이크 숨김. 데스크톱은 IPC `stt:changed`로 즉시 반영.
  - 결과는 바로 보내지 않고 입력창 끝에 붙여 사용자가 고친 뒤 보낸다.
  - 권한: macOS `NSMicrophoneUsageDescription`(+ Electron 미디어 권한 허용), iOS 같은 키, Android `RECORD_AUDIO`·`MODIFY_AUDIO_SETTINGS`(Capacitor WebChromeClient가 런타임 권한 요청).
- UX(UX-SPEC은 그대로, 여기 기록): 데스크톱 설정에 [음성] 탭(사용 토글·상태, 모델 목록: 선택·받기/진행률·취소/지우기). 웹·모바일 설정의 원격 화면에 "음성 입력 — PC 설정을 따릅니다" 상태. 입력창의 마이크 버튼(녹음 중 경과 초·끝내기, 변환 중 표시).
- 대안: Web Speech API — 브라우저·OS마다 다르고 Chrome은 Google 서버로 음성을 보내며 Electron에서 동작하지 않아 기각. OpenAI Whisper API — 유료·키 필요라 기본값으로 기각(추후 API 키 provider로 추가 가능). 휴대폰에서 직접 whisper 실행 — 모델 용량·성능 부담이 커서 기각. whisper.cpp 서버 모드 상주 — 메모리를 계속 잡아서 기각(녹음마다 실행, Metal에서 1초 내외).

### ADR-046 · 2026-10-15 · 웹·모바일에서 PC 음성 설정 관리 (ADR-045 변경)
- 배경: 사용자 요청 — "모바일앱에서도 PC의 음성 설정을 할 수 있게". ADR-045는 켜기·모델·받기·지우기를 데스크톱 IPC로만 허용했다.
- 결정: 페어링된 기기도 PC 음성 설정을 보고 바꿀 수 있다. 페어링 자체가 PC의 CLI 실행을 맡기는 신뢰 관계이고, 바꿀 수 있는 것은 켜기·모델 선택·카탈로그 모델 받기·지우기뿐이다(임의 URL·경로 없음).
  - 프로토콜: `stt.state.get` → `stt.state{state: SttState}`, `stt.manage{op: enable|disable|select|download|cancel|remove, model?}` → `stt.state` 또는 `stt.error`. 원격 호스트 검증은 op 목록과 `isSttModelId`를 확인하고, 모델이 필요 없는 op에서는 model을 버린다. 엔진이 없는 bridge(헤드리스 server)는 `STT_UNSUPPORTED`.
  - `download`는 시작만 하고 바로 상태를 돌려준다(수백 MB라 요청을 붙잡지 않음). 진행률·실패는 `state.download`·`state.error`로 본다. 다른 모델을 받는 중이면 거절, 이미 받았거나 받는 중이면 그대로 돌려준다.
  - UI: 웹·모바일 설정의 원격 화면이 데스크톱과 같은 음성 관리 화면(`VoiceManager`)을 쓴다. PC와 연결된 동안만 상태를 물으며, 받는 중에는 1초, 아니면 10초마다 갱신한다. 원격 문구로 "여기서 바꾼 설정은 PC와 연결된 모든 기기에 함께 적용"·"받는 동안 화면을 닫아도 PC가 계속 받음"을 알린다. 연결 전이거나 새 메시지를 모르는 예전 PC(오류·시간 초과)면 읽기 전용 상태("PC 설정을 따릅니다")로 돌아간다.
  - 데스크톱은 그대로 IPC로 관리한다(내장 bridge 허용 목록에 새 메시지를 넣지 않음).
  - 함께 고침: 모델 받기 취소 시 대기 중인 파일 쓰기가 `ERR_STREAM_DESTROYED`를 처리되지 않은 오류로 던질 수 있었다(main 프로세스 종료 위험). 쓰기 스트림에 error 처리를 붙이고 drain 대기에서 리스너를 정리한다.
- 대안: 원격에서 받기를 끝날 때까지 기다리기 — 수 분짜리 요청이 연결 끊김·시간 초과에 약해 기각. sync 채널로 상태 푸시 — 음성 설정은 학습 데이터가 아니고 폴링으로 충분해 기각.

### ADR-047 · 2026-10-15 · 헤드리스 `rhymebook serve`도 음성 입력 지원 (ADR-045 변경)
- 배경: 사용자 질문 — "PC에서 서버 버전으로 올려도 (음성 입력을) 쓸 수 있지? 모바일에서 음성 설정도 가능하지?". ADR-045는 헤드리스 server를 STT 미지원으로 두어, 서버에 붙은 모바일·웹은 마이크가 숨겨지고 설정에 "PC 앱을 업데이트하면…"이라는 맞지 않는 안내가 나왔다.
- 결정: 헤드리스 호스트도 데스크톱과 같은 `createSttEngine`을 bridge에 붙인다. 원격 기기(모바일·웹)는 ADR-046 화면으로 켜기·모델 선택·받기·취소·지우기를 그대로 한다.
  - 저장 위치: 데이터 폴더의 `stt/`(`settings.json`, `models/`). 기본은 꺼짐, 모델 없음 — 원격에서 켜고 받기 전에는 아무것도 받지 않는다.
  - whisper-cli는 번들하지 않는다(서버는 소스·단일 cjs 배포). `--whisper-cli <경로>` → `BRANCH_WHISPER_CLI` → PATH·Homebrew 경로 순으로 찾는다. 시작 화면에 음성 입력 상태(켜짐·모델·엔진 유무와 설치 안내)를 한 줄로 보여 준다.
  - 종료(Ctrl+C) 시 받던 모델은 멈추고 임시 파일을 지운다.
  - `HeadlessHostOptions.stt`(엔진 옵션 또는 `false`)로 테스트에서 가짜 whisper·fetch를 주입한다.
  - UI: bridge가 `STT_UNSUPPORTED`로 답하면(이전 버전 서버) "이 PC는 아직 음성 입력을 지원하지 않아요. PC 앱이나 rhymebook 서버를 업데이트하면 쓸 수 있어요."로 안내한다.
- 대안: 서버에 whisper-cli 번들 — 플랫폼별 빌드가 필요하고 서버 배포 형태(소스 실행)와 맞지 않아 기각(B-11과 같은 과제). 서버 터미널 옵션으로만 설정 — 사용자가 모바일에서 관리하길 원하고 ADR-046 경로가 이미 있어 기각.

### ADR-048 · 2026-10-15 · 퀴즈 스킬과 대화창 퀴즈 카드
- 배경: 사용자 요청 — 기본 스킬에 퀴즈를 넣고, 대화창에서 OX·객관식·주관식을 카드로 한 문제씩 풀며 정오·정답·해설을 보고 싶다.
- 결정: 새 메시지 타입이나 provider 기능 없이, 답변 마크다운 안의 ```quiz 코드 블록(JSON)을 UI가 카드로 그린다.
  - 형식: `{title, questions:[{type:'ox', question, answer:true|false, explanation} | {type:'choice', question, choices[2–8], answer:1부터 번호, explanation} | {type:'short', question, answer, accept[], explanation}]}`. 파서(core `parseQuiz`)는 모델 출력을 믿지 않는다: 문제 배열만 온 경우·"O"/"X"·"2번"·보기 문장 그대로의 정답도 받고, 형식이 틀린 문제는 빼고, 남는 문제가 없으면 일반 코드 블록으로 보인다. 최대 30문제·보기 8개·문자열 2000자.
  - 채점: OX·객관식은 일치, 주관식은 NFKC·소문자·공백/문장부호 무시 후 대표 답·인정 답 비교. 주관식 오답은 "같은 뜻으로 답했어요 — 정답으로 처리"로 스스로 고칠 수 있다(표현이 다양한 주관식 특성).
  - 스킬: 기본 스킬 `quiz`(「퀴즈 풀기」)를 추가하고 기존 사용자에게도 같은 이름이 없으면 시드한다. 기본 5문제·유형 섞기·블록 밖은 안내 한 줄.
  - 카드: 진행 막대·"N / 총", 한 문제씩, 답하면 정오·정답·해설 → [다음 문제] → 마지막에 점수·문제별 정오·[다시 풀기]. 문제·보기·해설은 마크다운·수식 지원. 생성 중에는 "퀴즈를 만드는 중…"(반쯤 온 JSON을 그리지 않음).
  - 가지 앵커: 원래 `<pre>`를 hidden으로 남기고 카드는 `data-anchor-ignore`로 감싸, 렌더 텍스트 오프셋이 원문과 같다. 카드 안 텍스트는 가지 선택 대상이 아니다.
  - 풀이 기억: 메시지 id + 블록 위치 키로 메모리 + localStorage(`rb.quiz.*`). 기기 간 동기화는 하지 않는다(학습 데이터가 아니라 화면 상태).
  - 책 PDF는 자체 마크다운 렌더러를 써서 퀴즈 블록이 코드로 남는다(카드 상호작용은 인쇄물에 의미 없음).
- 대안: 퀴즈를 별도 메시지 타입·DB 테이블로 — 저장·동기화·provider 모두 바꿔야 해 기각. 모델과 턴마다 문답(답을 보내고 채점받기) — 느리고 토큰을 쓰며 즉시 정답을 보여 줄 수 없어 기각(나중에 "틀린 문제 다시 묻기"로 확장 가능).

### ADR-049 · 2026-10-15 · 선택 메뉴 복사 버튼과 모바일 앱 시스템 텍스트 메뉴 숨김
- 배경: 사용자 요청 — 모바일 앱에서 본문을 드래그하면 OS 기본 메뉴(복사·전체 선택·공유 등)가 우리 선택 메뉴 위에 겹쳐 뜬다. 숨기고, 대신 우리 메뉴에 [복사]를 넣고 싶다.
- 결정:
  - 선택 메뉴(데스크톱 팝업·모바일 하단 바)에 [복사] 추가: `navigator.clipboard.writeText`, 실패 시 `execCommand('copy')`. 누르면 1.5초간 "복사됨"을 보이고 메뉴·선택은 그대로 둔다(이어서 가지를 만들 수 있게). 모바일 버튼 격자 4칸, 데스크톱 메뉴 폭 440px. UX-SPEC의 선택 메뉴 항목에 [복사]가 더해진 것으로 본다.
  - 모바일 앱(Capacitor)만 네이티브에서 시스템 텍스트 메뉴를 숨긴다. 웹·데스크톱은 그대로.
    - iOS: `AppWebView`(WKWebView 하위 클래스)가 `canPerformAction`을 거절하고 `buildMenu`에서 메뉴를 비운다. `AppViewController`(CAPBridgeViewController)가 이 웹뷰를 쓰고 로컬 플러그인을 등록한다.
    - Android: `AppWebView`(CapacitorWebView 하위 클래스)가 `startActionMode`를 감싸 메뉴를 `clear()`한다. 액션 모드 자체는 시작시켜 선택 핸들·선택이 유지된다. `capacitor_bridge_layout_main.xml`로 교체.
  - 입력창 예외: JS 가드(`apps/mobile/src/textMenu.ts`)가 포커스된 입력·편집 영역이 있을 때만 로컬 플러그인 `TextMenu.setSuppressed(false)`로 시스템 메뉴(붙여넣기 등)를 돌려준다.
- 대안: CSS `-webkit-touch-callout: none`·`user-select` — iOS 일부 메뉴만 막고 Android 액션 모드는 못 막으며 선택 자체를 막아 기각. Android `startActionMode`에서 null 반환 — 선택이 바로 풀려 기각. `contextmenu` 이벤트 차단 — 네이티브 선택 메뉴에는 효과 없음.

### ADR-050 · 2026-10-15 · 발음 듣기 — 기기 음성 기본, OpenAI 음성 하나, 실패 시 기기 음성으로 대체
- 배경: 사용자 요청 — 영어·베트남어 학습용 발음 듣기. 비교 프로토타입(브랜치 `prototype/tts-compare`: 기기/브라우저·macOS say·Piper·클라우드)을 들어 본 결과 "기기 OS가 가장 낫다". 기본은 기기 음성, 선택으로 OpenAI API만 연동하고 활성 음성은 하나, OpenAI가 실패(토큰·한도 부족 등)하면 자동으로 기기 음성으로 읽는다.
- 결정:
  - 선택 메뉴(데스크톱 팝업·모바일 하단 바)에 [듣기]/[멈춤] 추가(모바일 5칸, 데스크톱 메뉴 폭 500px). 선택한 글(없으면 앵커 텍스트)을 읽는다. 한 번에 하나, 새로 읽으면 이전 것은 멈춘다.
  - core `tts.ts`(순수): 글 정리(NFC — 베트남어 조합형 성조 → 완성형, 마크다운 기호·링크 주소 제거, 4000자 제한), 언어 감지(한글 > 라틴이면 ko, 라틴 단어 중 베트남어 글자 단어가 20% 이상이면 vi, 아니면 en), 기기 음성 고르기(정확한 지역 > 같은 언어, 내장 > 기본), OpenAI 합성, 대체 안내 문구.
  - 기기 음성: `speechSynthesis` + `lang`(vi-VN·en-US·ko-KR) + 맞는 음성. 기기에 그 언어 음성이 없으면 언어별 한 번 "기기 설정에서 음성을 추가하면…" 안내(그래도 OS에 맡겨 읽음).
  - OpenAI: `POST /v1/audio/speech`, `gpt-4o-mini-tts`, mp3, 설정에서 고른 음성 하나(기본 marin), 언어별 지시(베트남어는 하노이 북부 표준 억양). 키는 기존 보안 저장소의 `apikey:openai-api`(연결 탭의 OpenAI 키와 같음)를 쓰고, 원격 전용 기기는 설정 › 음성에서 직접 넣는다. 오류 분류는 기존 `httpError`/`thrownError` — 키 없음·401(auth), 429(rate-limit: 크레딧·한도), 연결 실패(offline), 5xx(network) → 원인 토스트 + 같은 글을 기기 음성으로 대신 읽기. 중지(aborted)는 대체하지 않는다. 오류 메시지에 키를 넣지 않는다.
  - 같은 음성·글은 다시 합성하지 않는다(blob URL 30개 캐시, 토큰 절약).
  - iOS 자동 재생 제한: 누른 순간 무음 WAV와 빈 utterance로 audio·음성을 깨워 두어, 비동기 합성 후 재생·대체 재생이 막히지 않게 한다.
  - 설정은 기기별(localStorage `branch.tts`, 동기화 안 함) — 키와 기기 음성이 기기마다 다르다. 설정 › 음성 탭은 음성 입력이 없는 플랫폼에서도 항상 보인다(「읽어 주기」 섹션, 미리 듣기 버튼).
  - 한계: Android WebView에는 `speechSynthesis`가 없어 Android 앱은 "이 기기에서는 음성으로 읽어 줄 수 없어요"만 안내한다(후속: Capacitor TTS 플러그인으로 기기 음성 연결). → ADR-051에서 해소.
- 대안: 클라우드(Azure 등)를 기본으로 — 비교에서 기기 음성이 낫고 무료·오프라인이라 기각. 여러 OpenAI 음성 혼용(언어별) — 요청대로 하나만. 실패 시 오류만 표시 — 학습 흐름이 끊겨 기각. Piper 등 로컬 신경망 번들 — 용량이 크고 베트남어 품질이 기기 음성보다 낮아 보류.

### ADR-051 · 2026-10-15 · 모바일 앱 발음 듣기 — 네이티브 기기 음성
- 배경: 사용자 요청 "모바일앱도 읽을수있게". Android WebView에는 `speechSynthesis`가 없어 앱에서 [듣기]가 안 됐다(ADR-050 한계). iOS WKWebView는 있지만 무음 스위치에 막히고 음성 고르기가 제한적이다.
- 결정:
  - `@capacitor-community/text-to-speech`(iOS AVSpeechSynthesizer, Android TextToSpeech)를 mobile 앱에만 넣고, `MobileApi.speech`(voices·speak·stop)로 주입한다(ADR-019 방식, ui는 Capacitor에 의존하지 않음). 모바일 앱은 두 플랫폼 모두 이 경로를 쓰고, 웹·데스크톱은 `speechSynthesis` 그대로.
  - 음성은 core `rankDeviceVoices`(정확한 지역 > 같은 언어, 내장 > 기본)로 순위를 매겨 최대 3개를 차례로 시도한다. 두 번째는 종류(내장/온라인)가 다른 음성 — 내장 음성들은 같은 음성 데이터를 나눠 써서 하나가 깨지면 다 깨진다(에뮬레이터 en-US 내장 음성 데이터 손상으로 실측, 온라인 음성으로 대체 재생 확인).
  - 그 언어가 기기에 없으면(플러그인 "not supported") "기기 설정의 음성(텍스트 음성 변환)에서 ○○를 추가해 주세요" 안내. 그 밖의 실패는 "기기 음성으로 읽지 못했어요".
  - 이전 발화는 네이티브가 새 speak에서 스스로 끊으므로(Android QUEUE_FLUSH, iOS 플러그인이 stop 후 재생) 시작 때 stop을 따로 부르지 않는다(경합 방지). [멈춤]·OpenAI로 읽을 때만 stop.
  - iOS: `AVAudioSession` `.playback` + `.spokenAudio` + `.mixWithOthers`(AppDelegate) — 무음 스위치가 켜져 있어도 읽고, 다른 앱 음악은 끊지 않는다.
- 대안: 앱 안에 웹 TTS 폴리필 — Android WebView에 엔진 접근 수단이 없어 불가. 직접 플러그인 작성 — 커뮤니티 플러그인이 Capacitor 8·SPM을 지원해 불필요. 내장 음성만 시도 — 데이터 손상 기기에서 계속 실패해 기각.

### ADR-052 · 2026-10-16 · 음성으로 읽기 스킬 · 읽기 카드 · 요청 맞춤 스킬 자동 사용
- 배경: 사용자 요청 — 기본 스킬에 음성 읽기 추가, 세션(대화창)에서 음성 재생, 채팅 요청에 맞는 스킬이 있으면 자동으로 수행.
- 결정:
  - 기본 스킬 `/speak`(id `skill-speak`, 「음성으로 읽기」). 답변은 한 줄 안내 + ```speak JSON 블록 `{title, items:[{text, lang: vi|en|ko, note}]}`. 기존 사용자에게는 id 기준 seed로 추가된다(지운 기본 스킬은 되살리지 않는 기존 규칙 그대로).
  - 대화창: 퀴즈 카드(ADR-048)와 같은 방식 — ```speak 블록 자리에 읽기 카드, 원본 `pre`는 숨겨 남겨 앵커 오프셋 유지, 카드는 `data-anchor-ignore`. 줄마다 [듣기]/[멈춤], 머리의 [모두 듣기]는 차례로 이어 읽는다. 엔진은 발음 듣기(ADR-050/051) 그대로(기기 음성·OpenAI·모바일 네이티브, 실패 시 대체). 해석은 관대하게(JSON이 아니면 줄마다 한 문장), 읽을 줄이 없으면 코드 블록 그대로.
  - 재생 큐: `speakAll`이 남은 줄을 모듈 큐에 두고 자연 종료 때만 다음 줄로. 재생마다 id(seq)를 매겨 취소·이전 발화의 늦은 콜백이 큐를 넘기지 않게 한다. [멈춤]·새 [듣기]는 큐를 비운다. `useSpeech.key`로 지금 읽는 줄을 강조.
  - 자동 스킬: core `matchSkill` — 결정적 규칙만(질문마다 AI를 한 번 더 부르지 않음). 기본 스킬은 이름별 의도 표현(퀴즈 내 줘·발음 들려 줘·커리큘럼·책으로 엮어 등), 그 밖의 스킬은 질문에 스킬 제목(3자 이상)이나 명령 이름(단어 경계)이 나올 때. 의도 > 언급, 같으면 먼저 나온 것. 슬래시 명령·이미 고른 스킬이 있으면 쓰지 않는다.
  - 투명성: 입력 중 맞는 스킬이 있으면 입력창 위에 점선 "자동" 칩(✕로 이번 질문에서 빼기, 입력을 비우면 다시 판단). 보낸 메시지에는 기존 스킬 배지가 붙는다. 설정 › 일반(원격 기기는 설정 화면)에서 「요청에 맞는 스킬 자동 사용」 끄기 — 기기별(localStorage `branch.autoSkill`, 기본 켜짐).
  - 스킬 모델(`SkillRef`·동기화 검증)은 바꾸지 않는다(트리거 필드 추가 안 함).
- 대안: 질문마다 모델에게 스킬 선택을 묻기 — 지연·토큰 비용이 늘고 원격·CLI provider마다 동작이 달라 기각. 스킬에 사용자 정의 트리거 필드 — 동기화 계약 변경이 필요해 보류(제목·이름 언급으로 대체). 칩 없이 조용히 적용 — 오탐 시 사용자가 알 수 없어 기각. 읽기 카드 없이 텍스트만 — 요청("세션에서 음성 재생")에 못 미쳐 기각.

### ADR-053 · 2026-10-16 · OpenAI 읽기 — 언어별 탭(베트남어 북부/남부 억양), 공통 모델 선택
- 배경: 사용자 요청 — OpenAI 사용 시 언어별 설정을 탭으로 나누고, 베트남어는 남부/북부를 고르게. 공통 설정으로 모델도 바꿀 수 있게.
- 결정:
  - `TtsPrefs`에 `openaiModel`(gpt-4o-mini-tts 기본 · gpt-4o-mini-tts-2025-12-15 · tts-1 · tts-1-hd), `viAccent`(north 기본/south), `enAccent`(us 기본/uk) 추가. 이전 저장값은 기본값으로 채워 읽는다.
  - 억양은 core `speechInstructions`의 OpenAI 지시(instructions)로만 반영한다. tts-1 계열은 instructions를 받지 않으므로 보내지 않고, 설정에 "억양 지시를 받지 않아요" 안내. tts-1 계열이 지원하지 않는 음성(marin·cedar·ballad·verse)은 목록에서 빼고, 모델을 바꾸면 `fitVoiceToModel`로 맞춘다.
  - 설정 › 음성(OpenAI): 공통(모델·음성·키) 아래 [베트남어|영어|한국어] 탭 — 억양 선택과 그 언어 들어 보기. 한국어는 표준어 고정.
  - 캐시 키에 모델·언어·억양을 넣어 설정을 바꾸면 다시 합성한다.
  - 기기 음성은 BCP-47 태그(vi-VN)로 억양을 구분할 수 없어 바꾸지 않는다(기기에 설치된 음성을 따른다고 안내).
- 대안: 기기 음성 직접 고르기 — 기기마다 남부 음성 유무가 달라 보류. 언어별 모델·음성 — 요청은 모델 공통이라 기각.

### ADR-054 · 2026-10-16 · 직접 만든 하위 세션 — 각주
- 배경: 사용자 요청 — 좌측 패널 모든 세션 오른쪽 [+]로, 본문 선택 없이 직접 입력한 질문으로 하위 세션을 만들고, 부모 세션에 각주로 표시·내비게이션 하단에 고정.
- 결정:
  - 모델 변경 없음: `parentId`는 있고 `anchor`가 없는 세션을 "각주(직접 만든 하위 세션)"로 본다. core `createSubSession(parentId, question)` — 제목은 질문 앞부분, provider·모델 설정 상속, 첫 질문 자동 전송. `footnoteChildren`은 앵커 없는 자식을 만든 순서로.
  - 맥락: 앵커가 없으므로 조상 경로 + 부모 대화 최근 메시지 + "부모 주제와 관련된 질문" 지시문을 넘긴다(앵커 가지와 같은 상속 규칙, 인용 구간만 없음).
  - 동기화: 새 op `subsession {id, parentId, question, messageId}`. 기존 `branch` op는 그대로(구 클라이언트 호환).
  - UI: 사이드바 루트·가지 모든 행에 [+](터치 기기는 항상 보임) → "하위 세션 만들기" 창(모바일 하단 시트·데스크톱 카드, ⌘/Ctrl+Enter). 부모 대화 끝 "각주" 목록 `[n] 제목 · 요약됨`, ChatNav 가지 패널 하단에 "각주" 섹션 고정.
- 대안: 가짜 앵커(빈 인용)로 기존 branch 재사용 — 앵커 복원·하이라이트 경로가 깨져 기각. 별도 세션 종류 필드 — 저장·동기화 스키마 변경이 커서 기각.

### ADR-055 · 2026-10-16 · 보관함 — 조각 보관·폴더 트리·페이지
- 배경: 사용자 요청 — 응답으로 만들어진 글·이미지·음성을 별도 저장공간에 보관, 폴더 트리로 관리, 조각을 엮어 새 페이지 구성.
- 결정:
  - core `vault.ts`: `VaultNode = folder | item | page`(공통 id·parentId·name·시각). item은 `text` / `image`(첨부 그대로) / `audio`(글+언어 — 재생은 현재 읽기 엔진으로 다시 합성, 오디오 파일을 저장하지 않음), 출처 `{sessionId, messageId}`. page는 `{itemId}` 참조 블록과 `{text}` 글 블록의 순서 목록 — 조각을 복사하지 않고 참조한다(조각이 지워지면 "지워진 조각" 표시).
  - 저장: AppData `vault`, Dexie v5 `vault` 테이블, 백업 스냅샷 포함(구 백업은 빈 보관함). 원격 기기는 sync op `vault.put` / `vault.delete`(폴더는 자손까지), 호스트는 `isVaultNode`로 형식·크기·허용 필드를 검증하고 폴더 순환 이동을 거부, 초기 동기화는 페이지 단위 `sync.vault`.
  - 보관 진입점: 답변 [보관], 선택 메뉴 [보관](선택한 글), 이미지 보기 [보관함에 담기], 읽기 카드 [보관](한 언어면 한 조각, 섞이면 줄마다). 새 조각은 보관함 맨 위.
  - 화면: 상단 [보관함] → 트리(새 폴더·새 페이지, 접기) + 상세(이름·옮길 폴더·지우기). 페이지는 보기/편집 — 조각 넣기(검색)·글 넣기·위아래·빼기, Markdown 저장. 모바일은 목록↔상세 전환.
- 대안: 메시지 북마크만 — 이미지·선택 글·폴더·페이지 요구를 못 채워 기각. 페이지에 조각 복사 — 원본 수정·삭제가 반영되지 않고 용량이 커져 기각. 음성 파일 저장 — 엔진별 합성 결과가 커서 글+언어로 대체.

### ADR-056 · 2026-10-16 · 모바일 세션 내비게이션 핸들 · 숨기기
- 배경: 사용자 요청 — 모바일에서 세션 내 내비게이션이 본문을 가리므로 핸들로 옮기고(좌/우 가장자리에 붙고 세로는 자유, 가운데 놓으면 애니메이션으로 가까운 쪽에 붙음), 핸들 탭 → 숨기기, 숨기면 세션 상단 provider 선택 오른쪽 내비 아이콘으로, 누르면 다시 표시.
- 결정:
  - < 768px에서만: ChatNav 도구 묶음을 세로 도크로 바꾸고 맨 위 grip 핸들(pointer 이벤트)로 끈다. 놓을 때 `snapDock`(도크 중심 x가 패널 절반 기준)으로 좌/우와 세로 비율을 정하고 transition으로 붙인다. 세로 위치는 패널 안으로 제한(비율로 저장해 회전·크기 변경에도 유지). 움직임 6px 미만이면 탭으로 보고 메뉴(숨기기)를 연다.
  - 숨기면 `SessionHeader`의 provider 선택 오른쪽에 내비 아이콘 버튼(`NavRestoreButton`), 누르면 다시 표시.
  - 위치·숨김은 기기별 localStorage `branch.navDock`, 모든 패널 공유. 데스크톱(≥768px) 레이아웃은 그대로.
- 대안: 자유 위치(가운데 허용) — 요청에 반해 기각. 길게 눌러 끌기 — 스크롤과 충돌·발견성 낮아 별도 핸들로.

### ADR-057 · 2026-10-16 · 호스트 기능 목록 · 'outdated' 오류 · 보관함 저장 필수화
- 배경: 모바일에서 [보관함에 담기]·사이드바 [+] 하위 세션이 "요청을 처리할 수 없어요."로 실패. 원인은 PC에서 돌던 `rhymebook serve`가 0.16.0 이전 번들이라 `vault.put`·`subsession` op를 몰라 브리지가 `invalid`로 거절한 것. 조사 중 `gatedRepository`·서버 `fileRepo`가 보관함 저장 메서드를 넘기지 않아(선택 메서드 `?.`) 보관함이 IndexedDB·서버 파일에 저장되지 않던 버그도 발견.
- 결정:
  - `Repository.saveVaultNode` / `deleteVaultNodes`를 필수로 바꿔 래퍼·구현이 빠뜨리면 타입 오류가 나게 했다(gatedRepository·memory·fileRepo 보강, 테스트 추가).
  - `sync.snapshot`에 `features: ['subsession','vault']`(호스트 지원 기능)을 싣는다. 클라이언트는 목록이 있는데 기능이 없으면 보내지 않고 바로 `outdated`, 목록이 없는 옛 호스트(0.16.0 이하)에는 보내 보고 기능 op가 `invalid`로 거절되면 `outdated`로 바꾼다(0.16.0 호스트는 기능을 지원하므로 막지 않음).
  - 토스트: "PC 앱이 이 기능을 아직 몰라요. PC 앱(또는 rhymebook serve)을 최신 버전으로 업데이트해 주세요."
- 대안: 프로토콜 버전 숫자 — 기능 단위 판단이 어려워 기각. 목록이 없으면 무조건 차단 — 정상 동작하는 0.16.0 PC까지 막아 기각.

### ADR-058 · 2026-10-16 · 보관함 UI/UX 개편 — 전체 화면·끌어서 옮기기·상단 도구 모음·페이지 저장·나란히 배치
- 배경: 사용자 요청 — 태블릿 이상에서 보관함 창이 너무 낮고 전체 화면이 없음, 항목 이동이 상세의 select라 불편, 상세 버튼이 흩어져 있음, 페이지 자동 저장이 의도치 않은 변경을 남김, 블록을 끌어 옮기고 좌우로도 배치하고 싶음.
- 결정:
  - 창: `Modal size` 'auto' | 'tall'(md 이상 높이 80vh) | 'full'. 보관함은 기본 'tall', 닫기 왼쪽 [전체 화면으로 보기]/[창으로 보기]로 'full' 전환(기기별 `uiState.vaultFull`). 모달 스택을 두어 Esc는 맨 위 창만 닫는다(이동 선택 창 → 보관함 순).
  - 끌기: `vault/drag.ts` `beginDrag` — 마우스·펜은 6px(손잡이 3px) 움직이면 시작, 터치는 350ms 길게 눌러 시작(그 전 움직임은 스크롤), 손잡이는 터치도 바로. 끄는 동안 스크롤·메뉴·선택을 막고 놓은 직후 click을 삼키며 Esc로 취소. 가장자리 자동 스크롤(`edgeScroller`), 손가락 옆 미리보기.
  - 트리: 항목·폴더·페이지를 폴더 위에 놓으면 그 폴더로, 빈 곳에 놓으면 보관함 맨 위로. 같은 부모·자기 자신·자기 하위 폴더(`wouldCreateCycle`)는 놓을 수 없음, 닫힌 폴더 위에 잠시 머물면 펼침.
  - 상세: 위치 select 삭제. 상단 도구 모음 [페이지에 넣기]·[이동]·[복사](이미지는 [이미지 저장])·[지우기]·[수정하기]·([Markdown 저장])·[원래 대화 열기]. [이동]은 폴더 트리 선택 창(`FolderPicker`), [페이지에 넣기]는 페이지 선택 창. [수정하기]로 이름·글 편집 → [저장]/[취소].
  - 페이지: 자동 저장 대신 초안 편집 → [저장]. 저장하지 않은 변경이 있으면 다른 항목 선택·새로 만들기·목록으로·닫기 전에 "저장하지 않은 변경을 버릴까요?"로 묻는다.
  - 블록 배치: `VaultPageBlock.beside?: true` — 앞 블록과 같은 줄(한 줄 최대 `PAGE_ROW_MAX` 3). core 순수 함수 `pageRows`·`placePageBlock(before/after/left/right)`·`setPageBlockBeside`·`movePageBlock`(줄 유지)·`normalizePageBlocks`(첫 블록·넘침 정리). 손잡이를 끌어 다른 블록 위·아래(줄 사이) 또는 왼쪽·오른쪽 가장자리(나란히)에 놓는다. 위/아래 버튼 유지, [앞 블록 옆에 나란히]/[나란히 풀기]. 768px 미만에서는 줄을 세로로 쌓아 보인다.
  - 호환: `beside`는 새 필드라 0.16.0 호스트가 페이지 저장을 `invalid`로 거절할 수 있음 → ADR-057의 'outdated' 안내로 PC 업데이트를 알린다. 나란히 없는 페이지는 그대로 동작.
- 대안: HTML5 드래그앤드롭 — 터치(모바일·태블릿)에서 동작하지 않아 기각, 외부 라이브러리(dnd-kit) — 의존성 추가 대비 필요한 동작이 작아 자체 pointer 구현. 페이지 2차원 격자(행·열 좌표) — 데이터·동기화 변경이 커서 순서 목록 + `beside` 플래그로.

### ADR-059 · 2026-10-16 · 보관함 트리 — 놓을 자리 선 표시 · 같은 폴더 안 순서 바꾸기
- 배경: 사용자 요청 — 트리에서 끌 때 어디에 놓일지 미리 보이지 않고, 같은 폴더 안에서 항목 순서를 바꿀 수 없음(이름순 고정).
- 결정:
  - 모델: 폴더·조각·페이지에 선택 필드 `order?: number`(0 이상 정수). `vaultChildren`은 `order`가 있는 것을 먼저(작을수록 위), 없는 것은 기존 정렬(폴더 먼저·이름·만든 순)로 뒤에.
  - core 순수 함수 `placeVaultNode(vault, id, targetId, 'before'|'after', now)`: 대상의 부모로 옮기며 형제 전체에 0..n 번호를 다시 매기고 바뀐 노드만 돌려준다. 자기 하위 폴더로는 거절(`wouldCreateCycle`). `moveVaultNode`(폴더 안으로·[이동])는 `order`를 지워 새 폴더의 뒤쪽 기본 정렬로.
  - 놓을 자리: 조각·페이지 줄은 위 절반 → 앞, 아래 절반 → 뒤. 폴더 줄은 위 25% → 앞, 아래 25% → 뒤(펼친 폴더는 안으로), 가운데 → 폴더 안으로. 줄 밖 빈 곳 → 보관함 맨 위. 순서가 그대로인 자리는 표시하지 않는다.
  - 표시: 앞/뒤는 해당 줄 위·아래 가장자리에 들여쓰기 맞춘 강조색 선(+왼쪽 점), 폴더 안은 기존 폴더 강조. 펼치기 대기는 '안으로'일 때만.
  - 호환: `order`는 새 필드라 0.16.1 이하 호스트가 `vault.put`을 `invalid`로 거절 → ADR-057 'outdated' 안내로 PC 업데이트를 알린다. 순서를 바꾸지 않은 노드는 그대로 동작.
- 대안: 정렬 기준 고정(이름순) 유지 — 요청 불충족. 실수(fractional) 순서 키로 한 노드만 갱신 — 동기화 op는 줄지만 정밀도·정리 로직이 필요해, 형제 수가 작은 보관함에서는 다시 번호 매기기로 단순하게.

### ADR-060 · 2026-10-16 · 사이드바 너비 조절 · 분할창 이동 버튼 끌기 · 드래그 메뉴 글자 잘림 수정 · [질문에 첨부]
- 배경: 사용자 요청 — 좌측 패널 폭 고정, 분할창 자리 이동이 메뉴 클릭으로만 가능, 드래그 메뉴 [이게 뭐야?] 글자가 잘림, 선택한 글을 현재 세션 질문에 바로 붙일 방법이 없음.
- 결정:
  - 사이드바(데스크톱): 오른쪽 경계에 `role="separator"` 손잡이. pointer 끌기로 200~520px(기본 272), 끄는 동안은 저장하지 않고 놓을 때 localStorage `branch.sidebarWidth`(기기별)에 저장. 더블클릭 → 기본값, ←/→ 16px(Shift 48px).
  - 분할창 이동 버튼: `draggable` — 끌기 시작하면 세션 끌기(`SESSION_DRAG_TYPE`·`setDragSession`)로 기존 DropZone·`dropToSplit`을 그대로 재사용(가운데=자리 바꾸기, 가장자리=옆으로 옮기기). 분할 안 세션이면 안내 문구를 "…옮기기"로, 끌고 있는 창 자신에는 놓을 자리를 표시하지 않는다. 클릭하면 기존 메뉴.
  - 드래그 메뉴 글자 잘림: 원인 — 고정 폭(570px) 메뉴 안 `flex-1` 버튼에서 한글이 음절 단위로 줄바꿈되어 h-9 버튼 밖으로 잘림. 버튼 `whitespace-nowrap`, 메뉴는 내용 폭(`w-max`, 화면 폭 상한)·버튼 줄 `flex-wrap`, 위치 계산은 측정한 크기로.
  - [질문에 첨부]: 선택 글을 `> ` 인용으로 현재 세션 입력창 끝에 덧붙이고 포커스. 선택 메뉴는 전역 포털이라 입력창과 트리가 달라, ui `composerBridge`(세션별 입력창 등록 스택, 가장 최근 등록 우선)로 연결. 입력창이 열려 있을 때만 버튼 표시.
- 대안: 사이드바를 react-resizable-panels로 — 모바일 오버레이 구조와 겹쳐 기각. 이동 버튼 전용 pointer 끌기 — DropZone(HTML5 DnD)과 이중 구현이 돼 기각. 첨부를 전역 store 문자열로 — 입력창 로컬 상태와 동기화가 번거로워 등록 함수 방식으로.

### ADR-061 · 2026-10-16 · 드래그 메뉴 — 선택한 글 직접 고치기
- 배경: 사용자 요청 — 드래그로 고른 글을 질문하기 전에 직접 고치고 싶음(선택이 한두 글자 어긋나거나, 다른 표현으로 묻고 싶을 때).
- 결정:
  - 메뉴 서식 줄의 [선택한 글 고치기](연필) 버튼, 모바일은 상단 "…로 가지 치기" 글을 눌러 고치기 창(textarea·적용/취소, ⌘/Ctrl+Enter 적용, Esc 취소)을 연다. 원래 선택과 같게 적용하면 고치지 않은 것으로 본다.
  - 고친 글은 메뉴 위쪽 줄(데스크톱)·상단 글(모바일)에 표시하고 [고치기]·[원래 선택으로] 제공. 바깥을 눌러 새로 선택하면 버린다.
  - 쓰임: [이게 뭐야?]·[더 자세히]는 고친 글로 질문 문장(`branchQuestion`)을 만들어 `custom` 질문으로 보낸다, [직접 질문]은 고친 글을 인용으로 앞에 붙인다, [질문에 첨부]·[복사]·[듣기]·[보관]도 고친 글.
  - 앵커(원문 위치·하이라이트·가지 제목)와 서식·메모 범위는 원래 선택 그대로 — 앵커 복원이 원문 글과 일치해야 하므로. core·sync 프로토콜 변경 없음(옛 PC 호스트와도 호환).
- 대안: 앵커 글 자체를 바꾸기 — 원문에서 위치를 다시 찾지 못해 하이라이트가 깨져 기각. core `createBranch`에 질문 대상 글 인자 추가 — 프로토콜 변경이 필요한데 `custom` 질문으로 같은 결과를 얻을 수 있어 기각.

### ADR-062 · 2026-10-16 · OctoBooks 리브랜딩을 정식판(main)으로 — 기존 데이터·앱 업데이트 유지
- 배경: `preview/octobooks` 베타(v0.20.0-beta.1~3)에서 검증한 OctoBooks 리브랜딩(오션 팔레트 5종·새 아이콘·브랜드 문구)을 정식 v0.20.0으로 낸다. 베타는 안정판과 함께 설치되도록 별도 앱 ID(`app.octobooks.preview`)·데이터 폴더(`octobooks-preview`)·프리릴리즈 전용 워크플로를 썼다.
- 결정:
  - 디자인·테마·아이콘·브랜드 문구는 그대로 가져오고 표시 이름은 **OctoBooks**.
  - 앱 ID는 기존 값 유지 — 데스크톱 `app.branchlearn.desktop`, Android/iOS `dev.branchlearn.app`. 기존 설치가 새 버전으로 업데이트된다.
  - 데스크톱 내부 앱 이름은 `rhymebook` 유지(`app.setName`) — userData(`<appData>/rhymebook`)와 macOS safeStorage 키체인 항목(`rhymebook Safe Storage`)이 이 이름에 묶여 있어, 바꾸면 학습 기록·API 키를 읽지 못한다. Linux 실행 파일·deb 패키지 이름도 `rhymebook` 유지(업그레이드 연속성). 설치 파일 이름만 `octobooks-…`.
  - 릴리즈 워크플로: 정식 `v*` 태그는 초안(노트 작성 후 공개), `-beta.` 태그는 프리릴리즈(Latest 제외)로 바로 공개.
- 대안: preview 설정 그대로 머지 — 기존 사용자가 별도 앱을 새로 깔고 백업으로 데이터를 옮겨야 해 기각. 데이터 폴더를 `octobooks`로 옮기는 마이그레이션 — 키체인 항목까지 옮겨야 해 위험 대비 이득이 작아 보류.

### ADR-063 · 2026-10-19 · 웹·모바일 여러 PC 저장 · 메인 화면 연결 목록
- 배경: 사용자 요청 — 모바일 앱에서 여러 호스트(PC)에 붙어 작업할 수 있도록 메인 화면에 연결 목록을 띄우기. 지금은 페어링 하나만 저장해 다른 PC로 가려면 매번 다시 페어링해야 했다.
- 결정:
  - 저장: 페어링 목록을 비밀 저장소 `pairing:remote-hosts`(`REMOTE_HOSTS_SECRET`, 모바일 SecureStorage)에 JSON 배열로, `bridgeId`가 키(같은 PC 다시 페어링 = 자리 그대로 교체). 활성 페어링은 기존 `pairing:remote-bridge` 그대로 — remoteLink·provider 경로 변경 없음. 처음 읽을 때 목록에 없는 기존 활성 페어링을 앞에 넣어 옮긴다(core `hosts.ts` 순수 함수 + 테스트).
  - 전환: 목록에서 다른 PC를 누르면 활성 페어링 저장 → 동기화 클라이언트 stop → 거울(mirror) 비우기 → start. 다른 PC의 세션이 섞이지 않는다. 활성 PC를 누르면 오프라인일 때만 다시 연결.
  - 화면: 원격 모드 메인 화면(세션 없음·PC 연결 끊김 화면)에 "내 PC" 목록(이름·상태·경로, [목록에서 지우기], [PC 추가] → 페어링 폼). 설정 › 연결된 PC 아래에도 PC가 둘 이상이면 목록. 활성 PC를 지우면 연결 해제와 같다.
  - 데스크톱 앱의 "다른 PC에 연결"(BridgeCard)은 그대로 한 개만.
- 대안: 여러 PC에 동시 연결해 세션을 합쳐 보기 — 거울 store·sync 프로토콜이 PC 하나를 전제로 해 범위가 커서 기각. 목록을 localStorage에 — 기기 비밀(deviceSecret)이 들어 있어 기각.

### ADR-064 · 2026-10-19 · 웹·모바일 스킬 목록을 PC(연결)별로 · 연결 시 자동 동기화
- 배경: 사용자 요청 — 모바일에서 여러 PC(ADR-063)를 오가면 스킬이 기기 전체 하나로 저장돼, 1번 PC의 스킬이 2번 PC에 연결해도 그대로 남았다. PC 스킬은 스킬 관리의 [동기화]를 눌러야만 받았다.
- 결정:
  - 저장: IndexedDB v6 `hostSkills`(키 `[hostId+id]`, `hostId` = 페어링 `bridgeId`). 웹·모바일(원격 모드, 세션 창 제외)은 활성 PC의 행만 읽고 쓴다. 데스크톱은 기존 `skills` 테이블 그대로.
  - 전환: 시작(`loadHosts`)·PC 전환/페어링(`applyPairing`)에서 `switchSkillHost(bridgeId)`로 목록을 바꾼다. 페어링 해제면 빈 목록. 목록에서 지운 PC·해제한 PC의 스킬도 지운다(다시 페어링하면 PC에서 다시 받음).
  - 옮기기: 기존 기기 전체 스킬은 처음 연결 대상이 된 PC의 목록으로 한 번 옮긴다(kv `hostSkillsMigrated`).
  - 동기화: 동기화 상태가 `online`이 될 때마다(처음·전환·다시 연결) `sync.skills`로 PC 스킬을 받아 합친다. 합치기 규칙은 기존과 같다 — 이름이 같으면 PC 내용, 이 기기에서만 만든 스킬은 남긴다. 바뀐 게 있으면 알림. 실패(옛 PC·끊김)는 조용히 넘긴다. 받는 사이 PC가 바뀌면 받은 결과를 버린다.
- 대안: PC 목록으로 통째로 덮어쓰기 — 모바일에서 만든 스킬이 연결마다 사라져 기각. 스킬을 저장하지 않고 PC에서만 보기 — 오프라인일 때 스킬을 쓸 수 없어 기각.

### ADR-065 · 2026-10-19 · 질문 우클릭 → 하위 세션으로 분리
- 배경: 사용자 요청 — 세션 안 질문을 우클릭하면 그 질문을 하위 세션으로 분리하기. 첫 질문은 분리할 수 없다.
- 결정:
  - 단위: 질문 하나와 다음 질문 전까지의 답변(질문 삭제와 같은 턴, `turnMessageIds`). 첫 질문은 거부한다.
  - 결과: 부모 아래 앵커 없는 하위 세션(각주, ADR-054). 제목은 질문 앞부분(첨부만 있으면 `[첨부] 이름`). `createdAt = 질문 createdAt - 1`이라 새 필드 없이 ① 맥락 상속이 그 질문 이전 부모 대화까지 ② 부모 각주 표식이 원래 자리에 놓인다. 메시지는 id 그대로 sessionId만 바꿔 옮긴다.
  - 따라오는 것: 옮긴 답변에 앵커가 있는 가지, 옮긴 턴 위치에 붙은 각주 하위 세션(새 세션의 자식으로), 옮긴 메시지의 주석.
  - 원격: sync op `turn.split`(기능 `split`, 옛 PC면 'outdated' 안내). 삭제 권한은 필요 없다(지우지 않음). 호스트가 새 세션 id를 클라이언트에 미리 loaded로 표시해 옮긴 메시지를 바로 받는다. 답변 중인 세션은 거부.
  - UI: 본문 우클릭 메뉴에 [하위 세션으로 분리]를 [질문 삭제] 위에. 첫 질문이면 둘 다 비활성 + "첫 질문은 분리·삭제할 수 없어요."
- 대안: 그 질문부터 끝까지 통째로 분리 — 뒤 질문이 앞 맥락을 잃어 기각. 복사 후 원본 유지 — 중복 대화가 생겨 기각.

### ADR-066 · 2026-10-19 · 질문 우클릭 → 별도 세션으로 분리 (같은 레벨, AI 제목)
- 배경: 사용자 요청 — 질문을 하위 세션(ADR-065)이 아니라 지금 세션과 **같은 레벨**의 별도 세션으로 분리하고, 제목은 AI가 짓기.
- 결정:
  - 단위·따라오는 것(가지·각주 하위 세션·주석)은 ADR-065와 같다. store `splitTurn(..., { sibling: true })`, 공통 이동은 `relocateTurn`.
  - 위치: 지금 세션이 루트면 새 루트(학습), 하위 세션이면 같은 부모 아래 앵커 없는 세션(각주, `createdAt = 원래 세션 + 1`이라 각주 번호가 원래 세션 바로 뒤). 루트가 바뀌면 따라가는 가지의 자손까지 `rootId`를 바꾼다.
  - 제목: 먼저 질문 앞부분으로 만들고, 제목 요청(`buildTitleRequest`)을 비동기로 보내 그사이 제목이 바뀌지 않았을 때만 바꾼다(`aiTitle`, 실패면 질문 앞부분 유지).
  - 원격: sync op `turn.splitOut`(기능 `turns`, 옛 PC면 'outdated'). UI: 우클릭 메뉴 [별도 세션으로 분리].
- 대안: 형제 대신 항상 새 루트 — 하위 세션에서 분리하면 학습 맥락이 끊겨 기각.

### ADR-067 · 2026-10-19 · 질문을 다른 세션으로 옮기기
- 결정:
  - core `turnMoveTargets`·`planTurnMove`: 자기 자신과 옮길 턴에 따라가는 가지(그 안쪽 포함)는 대상에서 뺀다(순환 방지). 첫 질문·어느 쪽이든 답변 중이면 거부.
  - 대상 세션 **끝**에 붙인다: 옮기는 메시지·각주 하위 세션의 시각을 `max(now, 대상 마지막 + 1) - 질문 시각`만큼 민다(맥락 범위·각주 자리가 함께 움직임). 메시지 id는 그대로.
  - UI: 우클릭 [다른 세션으로 옮기기] → "질문 옮기기" 창(트리 순서, 제목 검색, 현재 세션·불가 대상 비활성). 원격: sync op `turn.move`.
- 대안: 드래그로 옮기기 — 모바일·마인드맵까지 일관된 조작이 어려워 메뉴 선택으로.

### ADR-068 · 2026-10-19 · 세션 재정리 — 기본 스킬, 하위 세션은 각주로
- 배경: 사용자 요청 — 세션마다 [재정리] 버튼으로 전체 질문을 하나의 질문·답변으로 정리. 기본 스킬로, 본문에서 파생된 하위 세션은 각주로.
- 결정:
  - 기본 스킬 5번째 `reorganize`(`REORGANIZE_SKILL_ID = 'skill-reorganize'`, 기존 사용자는 `skillsToSeed`로 추가). 사용자가 지웠으면 기본 사본을 쓴다.
  - 요청: `buildReorganizeRequest` — 상속 맥락 + 세션 전체 대화 + 하위 세션 목록(제목·앵커 글·요약)을 주고 `질문: …\n---\n답변` 형식으로 받는다. `parseReorganized`가 형식이 어긋나면 첫 질문을 질문으로 쓴다.
  - 진행: 임시 질문/답변을 붙여 스트리밍(저장 안 함). 성공해야만 옛 메시지를 지우고 질문 1 + 답변 1로 바꾼다. 실패·중지·빈 응답이면 임시 메시지만 걷어내 원래 대화를 그대로 둔다(UI는 원래 첫 메시지가 남았으면 실패 안내).
  - 하위 세션: 앵커를 지워 모두 각주(ADR-054)가 된다 — 새 본문에는 원래 선택 글이 없어 앵커를 복원할 수 없으므로. 만든 순서가 각주 번호.
  - 잃는 것(확인 창에 안내): 옛 메시지의 메모·하이라이트(주석), 질문 첨부(재정리 질문은 글만).
  - 원격: sync op `session.reorganize`. UI: 세션 헤더 [세션 재정리](답변이 있을 때), 확인 창.
- 대안: 새 세션으로 재정리본을 만들고 원본 유지 — 세션이 두 배로 늘어 사용자 요청(이 세션을 정리)과 달라 기각. 앵커를 새 답변에서 다시 찾기 — 글이 바뀌어 대부분 실패해 기각.

### ADR-069 · 2026-10-19 · 마인드맵 질문 목록 · 기본 스킬 배지
- 결정:
  - 마인드맵 세션 노드에 ▾ 토글(`aria-expanded`)로 질문 목록(최대 8줄 높이, 넘치면 노드 안 스크롤, `nowheel nodrag`). 노드 높이가 바뀌면 dagre 배치를 다시 한다. 원격 모드에서는 펼칠 때 `ensureMessages`로 메시지를 받는다.
  - 제목 클릭은 기존처럼 세션 창, 질문 클릭은 `revealTurn` — 세션을 열고(PC 팝업·모바일 시트) 그 질문으로 스크롤·포커스·잠깐 강조.
  - 앵커 없는 하위 세션 노드의 표시를 "각주 세션"으로.
  - 스킬 관리 목록에서 `builtin` 스킬에 "기본 스킬" 배지.

### ADR-070 · 2026-10-26 · 웹 검색 · 도구 사용
- 배경: 사용자 요청 — 세션에서 필요하면 웹 검색을 하고, 도구 사용 기능도 추가. 03-PROVIDERS 원칙 5(도구 비활성)를 웹 도구에 한해 완화한다.
- 결정:
  - 도구는 `web_search`(검색)·`web_fetch`(페이지 읽기)만 허용. 파일·셸·코드 실행 도구는 계속 끈다. 일반 대화(purpose 없음/'chat')에만 붙이고 요약·제목·스킬·재정리 요청은 도구 없이(`wantsWebTools`).
  - 세션별 토글 `Session.webSearch`(필드 없음 = 켜짐, `false` = 꺼짐). 입력창 모델 칩 옆 [웹 검색] 칩(`aria-pressed`). OpenAI API(Chat Completions)는 미지원이라 칩을 숨긴다(`supportsWebTools`).
  - Anthropic API: 서버 도구 `web_search_20260209`·`web_fetch_20260209`(Opus/Sonnet 4.6 이상), 그 밖의 모델은 기본판(`web_search_20250305`·`web_fetch_20250910`). `pause_turn`이면 받은 내용을 assistant 메시지로 붙여 최대 5회 이어 받는다.
  - Claude CLI: 켜면 `--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch`, 끄면 `--tools ''`. stream-json의 tool_use/tool_result로 사용 내역을 만든다. Codex CLI: `-c web_search=live|disabled`(셸 도구는 계속 끔), `web_search` 항목 파싱.
  - 사용 내역 `ToolActivity {id,name,status,query?,url?,sources?}`를 `Message.tools`에 같은 id로 갱신 저장, 답변 위 `ToolActivityList`로 검색어·출처(http(s)만, 새 창 `noopener`) 표시. 도구 뒤 이어지는 글은 문단을 나눈다.
  - bridge: `chat.start.webSearch`, 서버 메시지 `chat.tool`. 스트림은 done/error에서만 끝난다. 원격: sync op `session.agent`의 `webSearch`(호스트 기능 `websearch`, 옛 PC면 'outdated').
- 대안: 파일 읽기 등 범용 도구까지 허용 — 사용자 파일 접근이 생겨 정책 원칙 5에 어긋나 기각. 앱이 검색 API를 직접 호출(클라이언트 도구) — 별도 키·비용이 필요하고 CLI 구독 경로와 맞지 않아 기각.

### ADR-071 · 2026-10-26 · 자세히 입력하기 (전체 화면 입력창)
- 배경: 사용자 요청 — 긴 질문을 편하게 쓰도록 입력창을 전체 화면으로 펼치고, Enter로 바로 보내지지 않게.
- 결정:
  - 입력창 마이크 앞 [자세히 입력하기](Maximize2, `aria-pressed`). 누르면 같은 Composer 상태(글·첨부·스킬)를 그대로 `document.body` 포털의 전체 화면 창(`role=dialog`, z-[55] — 설정 등 모달(z-60)은 위에 뜬다)으로 옮긴다. 원래 자리엔 첫 줄을 보여 주는 점선 자리 표시(누르면 접기).
  - 펼친 동안 Enter·Shift+Enter는 줄바꿈, Ctrl/⌘+Enter 또는 [보내기]로만 보낸다. Esc나 [입력창 접기]로 접고, 보내면 자동으로 접는다. 슬래시 스킬 목록은 위쪽에 연다.
  - 펼치기·접기 때 입력창에 포커스, 커서는 글 끝.
- 대안: 별도 편집 모달에 글을 복사했다가 돌려주기 — 첨부·스킬 칩·슬래시 명령을 따로 구현해야 해 기각.

### ADR-072 · 2026-10-27 · 마크다운 페이지 세션 · 새로 만들기 메뉴
- 배경: 사용자 요청 — 노션처럼 마크다운으로 직접 쓰는 빈 페이지 세션을 추가하고, 대화 답변과 똑같이 글을 골라 묻거나(가지) 정리(하이라이트·메모)할 수 있게. 사이드바 [새 학습]은 [새로 만들기] 메뉴(대화 / 빈 페이지)로, 페이지는 문서 아이콘.
- 결정:
  - 모델: 루트 세션에 `Session.kind = 'page'`(없으면 대화). 본문은 문서 메시지 하나(`role: 'assistant'`, `status: 'done'`, `pageDoc`)라 앵커·드래그 메뉴(`[data-anchorable]`)·어노테이션·가지·요약 카드·각주가 그대로 붙는다. 새 스키마·마이그레이션 없음.
  - store `newPage(id?, {focus?, docId?})`(제목 "새 페이지")·`updatePage(sessionId, content)`(본문 전체 교체). 페이지에는 `sendMessage`·`retry`·`splitTurn`·`moveTurn`·`reorganizeSession`이 동작하지 않는다.
  - 맥락: 부모가 페이지인 가지는 system 프롬프트에 "부모 문서 (학습자가 쓴 페이지)"로 본문(최대 6000자)을 싣는다.
  - UI `PagePanel`: 보기(마크다운 렌더 = `AssistantMessage`) ↔ 편집(마크다운 원문 textarea, 자동 높이) 토글을 헤더 [편집]/[완료]로. 빈 페이지는 편집으로 시작. 입력은 500ms 뒤·blur·세션 전환·닫기 때 저장. Esc/⌘+Enter로 편집 끝. 입력창(Composer)·모델 선택·PDF 버튼·세션 재정리는 없다. 헤더 제목을 눌러 이름 바꾸기.
  - 사이드바 [새로 만들기 ▾] 드롭다운(`role=menu`, 바깥 클릭·Esc로 닫힘) — 대화 / 빈 페이지. 페이지는 루트·가지 행과 마인드맵 노드에 `FileText` 아이콘. 빈 화면에도 [빈 페이지] 버튼.
  - 원격: sync op `page.new {id, docId}`·`page.edit {sessionId, content}`(호스트 기능 `page`, 옛 PC면 'outdated'). 클라이언트는 낙관적으로 반영하고 실패하면 되돌린다.
  - 본문을 고치면 원문이 바뀐 앵커는 기존처럼 "위치를 못 찾은 가지"로 칩에 남는다.
- 대안: 블록 단위 WYSIWYG 에디터(노션식) — 앵커·세그먼트 맵이 마크다운 렌더 결과에 맞춰져 있어 큰 재작성이 필요해 기각(이후 개선 여지). 페이지를 별도 엔티티로 — 트리·동기화·검색·삭제를 모두 따로 만들어야 해 기각.

### ADR-073 · 2026-10-27 · 페이지 / 블록 입력
- 배경: 이어서 할 작업 — 페이지 편집에서 노션처럼 `/`를 쳐서 제목·목록·표 등 블록을 넣기. 마크다운 원문을 몰라도 쓸 수 있게.
- 결정:
  - core `PAGE_BLOCKS`(제목 1·2·3, 글머리·번호·할 일 목록, 인용, 코드, 구분선, 표, 수식 11종)·`pageSlashQuery`·`filterPageBlocks`·`applyPageBlock` 순수 함수. 기존 스킬 `slashQuery`와 이름을 나눴다.
  - `/`는 줄 처음이나 공백 뒤에서만 메뉴를 연다(경로 `a/b`·URL 제외). 검색어는 공백 없이 20자까지, 코드·수식 울타리(```·~~~·$$) 안에선 열지 않는다. 한글 이름·영문 id/키워드(h1, hr, todo, table…) 접두 검색, 맞는 게 없으면 메뉴를 숨긴다.
  - 줄 블록(제목·목록·인용)은 `/검색어`를 표식으로 바꾸고, 빈 목록·인용 표식 뒤면 그 표식을 바꾸며 들여쓰기는 유지, 줄 중간이면 새 줄에 넣는다. 덩어리 블록(코드·구분선·표·수식)은 앞뒤를 빈 줄로 띄우고 커서를 안쪽(코드·수식 본문, 표 첫 머리글 선택)이나 다음 줄로 옮긴다.
  - 키보드: ↑↓ 선택, Enter/Tab 넣기, Esc는 메뉴만 닫고 편집을 이어간다(같은 `/` 자리에선 다시 열지 않음). 한글 조합 중(isComposing·229)에는 키를 가로채지 않는다. 클릭으로도 고른다(mousedown 기본 동작을 막아 포커스 유지).
  - 위치: textarea 거울 div로 커서 좌표를 재서(`lib/caret.ts`) 커서 아래에 띄우고, 스크롤 영역·visualViewport 아래 공간이 모자라면 위로 뒤집는다. `role=listbox`·`aria-activedescendant`.
- 대안: 블록 단위 WYSIWYG 에디터 — ADR-072와 같은 이유(앵커·세그먼트 맵이 마크다운 렌더 기준)로 기각. 툴바 버튼 — 모바일 공간을 차지하고 노션식 흐름과 달라 기각.

### ADR-074 · 2026-10-27 · 새 세션 빈 화면 · 대화 시작 시 목록에 추가
- 배경: 사용자 요청 — [새로 만들기]를 누르면 작은 메뉴(ADR-072) 대신 바로 빈 세션 화면이 뜨고, 대화를 시작해야 왼쪽 목록에 나타나게.
- 결정:
  - 사이드바 [새로 만들기]는 메뉴 없이 바로 빈 대화 화면을 연다(`startNewSession`). 빈 페이지는 빈 대화 화면의 [빈 페이지로 시작] 링크로 만든다(루트 대화에서만 보임).
  - 초안 = 메시지를 불러왔고 0개이며 하위 세션이 없는 루트 대화(`kind !== 'page'`). core `draftSessionIds`·`listedRootSessions`·`findDraftSession` 순수 함수. 초안은 사이드바 목록·시작점 개수·검색에 보이지 않고, 첫 메시지를 보내면 그대로 나타난다.
  - 원격 모드처럼 메시지를 아직 불러오지 않은 세션(`messages[id] === undefined`)은 초안으로 보지 않아 목록에서 사라지지 않는다.
  - 원격: 호스트 스냅샷에 초안 id(`drafts`, 선택 필드)를 담아 보내고 그 세션을 피어의 불러온 목록에 넣는다. 클라이언트는 빈 메시지로 불러온 것으로 보아 PC의 초안을 숨기고, PC에서 첫 질문을 보내면 밀려와 나타난다. 옛 호스트는 보내지 않아 이전처럼 보인다.
  - 질문 옮기기 대상 목록에서도 초안은 뺀다.
  - 남겨 둔 초안이 있으면 [새로 만들기]가 새로 만들지 않고 가장 최근 초안을 다시 연다 — 빈 세션이 쌓이지 않는다. 빈 화면의 [새 학습 시작]도 같은 동작.
- 대안: 세션 없이 UI만으로 그린 초안 화면 — 입력창·모델 선택·provider·웹 검색 설정이 모두 sessionId 기준이라 기각. 화면을 떠나면 초안 삭제 — 원격 동기화·분할 화면과 엇갈려 복잡하고, 재사용으로 충분해 기각.

### ADR-075 · 2026-10-27 · 노션식 실시간 마크다운 편집 · 하위 페이지 링크 · [+] 드롭다운
- 배경: 사용자 요청. 페이지 편집기에서 마크다운을 노션처럼 바로 서식으로 보여 준다. 사이드바 [+]는 질문 입력 창(ADR-054) 대신 [빈 페이지]·[세션]을 고르는 드롭다운으로 바꾼다. 편집기의 `/` 명령으로 하위 페이지를 만들고 하이퍼링크로 잇는다.
- 결정:
  - 편집기는 textarea 대신 CodeMirror 6(`PageEditor`, `livePreview`)을 쓴다. 원문은 그대로 두고 장식(decoration)으로만 렌더한다. 앵커가 마크다운 원문 오프셋에 의존하므로 원문을 바꾸지 않는다.
    - 커서나 선택이 닿지 않은 곳은 기호(`#`·`**`·`` ` ``·`[](url)`·`>`)를 숨기고 서식만 보인다.
    - 목록 기호는 `•`, 할 일은 체크박스(누르면 `[ ]`↔`[x]`), 구분선·표·수식(KaTeX)은 위젯으로 보인다.
    - 닿은 줄이나 블록은 원문이 드러난다. 편집기 포커스가 없으면 전부 렌더한다.
  - Enter는 목록을 이어 가고, 빈 목록·할 일 항목에서 누르면 목록을 끝낸다(노션식).
  - 보기/편집 전환([편집]·[완료])과 `/` 블록 메뉴(ADR-073)는 유지한다.
  - 하위 페이지 링크 형식은 `[제목](#page:<id>)`(core `pageLinkMarkdown`·`pageLinkId`)이다.
    - 읽기 화면(`Markdown` Anchor)과 편집기 위젯 모두 문서 아이콘 링크로 보인다. 누르면 그 페이지를 메인에 연다. 지워진 페이지는 흐린 표시로 남긴다.
    - 하위 페이지 이름을 바꾸면 부모 페이지 본문의 링크 제목도 바뀐다(`renamePageLinks`).
  - `/하위 페이지` 블록은 부모를 `parentId`로 한 빈 페이지를 만들고, 커서 자리에 링크를 넣는다. 화면은 이동하지 않는다.
  - 사이드바 행 [+]는 드롭다운(`SubCreateMenu`)이다.
    - [빈 페이지]: 빈 하위 페이지를 메인에 열고, 부모가 페이지면 본문 끝에 링크를 붙인다(`appendPageLink`).
    - [세션]: 질문 없이 빈 하위 대화(`newSubSession`, 제목 '새 학습')를 가지 자리(팝업·분할·모바일 시트)에 연다.
    - `SubSessionDialog`는 삭제했다. 앵커 없는 하위 세션은 이전처럼 부모의 각주가 되고, 하위 페이지는 각주에서 뺀다(링크로 보이므로).
  - 동기화:
    - `page.new`에 `parentId`를 더했다.
    - 새 op `session.child`를 만들고, 기능 플래그는 `subpage`다. 옛 호스트는 이 기능이 없어 하위 페이지·세션 만들기가 막힌다.
- 대안:
  - contenteditable WYSIWYG(ProseMirror·TipTap): 마크다운 왕복 변환이 원문 오프셋을 바꿔 앵커가 깨지므로 기각했다.
  - 편집·미리보기 나란히 보기: 노션식 요청과 맞지 않아 기각했다.

### ADR-076 · 2026-10-27 · 페이지 AI 정리·채우기 · 우클릭 메뉴 · 안내 문구 커서 높이
- 배경: 사용자 요청. 빈 페이지에서 여러 줄 안내 문구 때문에 커서가 여러 줄 높이로 보였다. 상단에 AI로 내용 정리 버튼을 두고, 편집 중 우클릭하면 마크다운 블록 메뉴와 AI로 내용 채우기를 띄운다.
- 결정:
  - 안내 문구(`.cm-placeholder`)는 `position:absolute`로 줄 흐름에서 뺀다. 그래서 빈 첫 줄과 커서는 한 줄 높이로 보인다.
  - core `pageAssist`:
    - 정리 요청 `buildPageOrganizeRequest`와 채우기 요청 `buildPageFillRequest`(커서 자리에 `[여기에 채우기]` 표시)를 만든다.
    - `cleanPageAssist`는 전체를 감싼 ```markdown 울타리와 남은 표시를 걷어 낸다.
    - `joinPageFill`은 여러 줄이면 빈 줄로 띄우고, 목록 뒤 목록이면 한 줄만 띄운다.
    - `purpose: 'page'`의 최대 토큰은 4096이다.
  - ui `app/ai.ts`:
    - `pickProvider`를 SkillAssist에서 옮겨 와 함께 쓴다.
    - `runAi`를 새로 둔다.
    - 원격이면 PC 연결부터 확인한다(`usePageAi`).
  - 페이지 머리의 [AI로 정리]:
    - 노트 전체를 정리해 한 번에 바꾼다.
    - 정리하는 동안에는 [정리 중…] 버튼으로 멈출 수 있고 편집기는 읽기 전용이다.
    - 끝나면 [되돌리기]가 뜬다. 다시 편집하면 [되돌리기]는 사라진다.
    - 정리하는 사이에 글이 바뀌었으면 결과를 버린다.
  - 편집 중 우클릭:
    - 누른 자리에 커서를 두고 메뉴를 연다. 메뉴는 [AI로 내용 채우기]와 블록 목록(`PAGE_BLOCKS`)이다. Shift+우클릭은 브라우저 기본 메뉴다.
    - 채우기는 요청을 비워도 된다(앞뒤 맥락대로). 글이 커서 자리에 흘러 들어오고, 멈출 수 있다.
    - 끝나면 채운 글을 한 덩어리로 다시 넣어 실행 취소 한 번에 지워진다.
  - 읽기 전용 잠금은 StateField + StateEffect(`EditorState.readOnly.from`)로 한다. Compartment reconfigure는 실시간 렌더(ADR-075)의 포커스 상태를 흐트러뜨려 기각했다.
- 대안: 정리 결과를 미리보기로 보여 준 뒤 적용하기 — 단계가 늘어 기각하고, [되돌리기]로 대신한다.

### ADR-077 · 2026-10-28 · 페이지 편집 선택 서식 팝업 · 끌어 고르기 · 읽기 모드 체크박스 · /이미지·/파일
- 배경: 사용자 요청.
  - 편집 중 마우스로 끌어 고르면 선택이 튀었다. 선택이 닿은 줄의 마크다운 기호가 드러나면서, 끄는 도중에 줄 모양이 바뀌었기 때문이다.
  - 고른 글에 서식을 입히는 팝업이 필요하다. 읽기 모드에서는 글자 효과(색·굵게·글꼴)를 숨긴다.
  - 읽기 모드에서 체크박스를 눌러 저장하고, `/` 메뉴로 이미지·파일을 넣고 싶다.
- 결정:
  - 실시간 렌더(livePreview):
    - 왼쪽 버튼 mousedown부터 window mouseup·blur까지를 `dragField`로 둔다. 그동안 선택만 바뀐 트랜잭션은 장식을 다시 만들지 않는다.
    - 원문 드러내기는 빈 선택(커서)에만 한다. 범위를 고르면 줄 모양이 그대로다.
  - core `pageFormat`:
    - `toggleInlineFormat`: 굵게·기울임·취소선·코드는 줄마다 앞뒤 공백 안쪽을 감싼다. 표시가 선택 바깥이든 안쪽이든 이미 감싸였으면 벗긴다(`***`는 굵게+기울임). 링크는 `[글](|)`로 넣는다.
    - `toggleTaskAt`, `taskItemOffsets`: 펜스 코드 블록 안은 뺀다.
    - `pageImageMarkdown`·`pageFileMarkdown`, 맥락·AI용 `stashEmbeds`·`restoreEmbeds`·`stripEmbeds`.
  - 편집기 선택 서식 팝업:
    - 비어 있지 않은 선택 위(공간이 없으면 아래)에 [굵게·기울임·취소선·코드·링크]를 띄운다.
    - 끄는 중·잠금·공백만 고른 경우에는 띄우지 않는다. 단축키는 ⌘B·⌘I·⌘⇧X·⌘E·⌘K다.
  - 읽기 모드:
    - SelectionMenu의 글자 효과를 페이지에서 숨긴다(묻기·메모는 유지).
    - 체크박스는 `TaskToggleContext`로 켠다. 화면의 n번째 체크박스를 원문의 n번째 할 일 항목(`taskItemOffsets`)에 저장한다. 원문 위치를 직접 쓰지 않는 까닭은 렌더 전 수식 구분자 변환으로 위치가 달라질 수 있어서다.
  - `/이미지`·`/파일`:
    - 고른 파일을 본문에 data URL로 넣는다(3MB까지, 이미지는 png·jpeg·gif·webp만). 파일은 `[📎 이름](data:… "이름")`이다.
    - html·svg·xml 형식은 `application/octet-stream`으로 바꿔 문서로 열리지 않게 한다.
    - 읽기 모드 `urlTransform`은 이 data URL만 허용하고, 파일 링크는 `download`로 내려받는다.
    - AI 정리·채우기와 가지 맥락에는 `embed:N` 자리표시로 보내고 돌아오면 되돌린다. 그래서 base64가 맥락을 차지하지 않는다.
- 대안:
  - 첨부를 vault(IndexedDB)에 따로 두고 참조만 넣기는 기각했다. 동기화·내보내기 경로가 늘기 때문이다. 크기 제한으로 대신한다.
  - 체크박스를 원문 위치(position offset)로 저장하기는 기각했다. 수식 변환으로 어긋날 수 있다.

### ADR-078 · 2026-10-28 · 사이드바 트리 접힘 상태 유지
- 배경: 왼쪽 패널(고정 사이드바·모바일 서랍)을 닫았다 열면 접어 둔 학습·가지 토글이 다시 펼쳐지거나 접혔다. 펼침 상태가 행 컴포넌트의 `useState`라서 패널이 닫힐 때(언마운트) 사라졌다. 행마다 "열린 세션을 담고 있으면 펼치기" 효과가 마운트마다 다시 돌아 접어 둔 것을 덮기도 했다.
- 결정:
  - 펼침 상태를 기기별 `useUi.treeOpen`(세션 id → 펼침, localStorage `branch.treeOpen`, 최근 1000개)에 둔다. 기록이 없으면 기존 기본값(학습은 열린 학습만 펼침, 가지는 펼침)을 쓴다.
  - 열린 세션까지 자동 펼치기는 항상 마운트된 `Sidebar`의 `useRevealActive`로 옮긴다. 열린 세션이 **바뀔 때만** 그 학습과 조상 가지를 펼치고 처음 값은 건너뛴다. 그래서 패널을 다시 열거나 새로고침해도 사용자가 접어 둔 상태를 덮지 않는다.
- 대안: 도메인 스토어·동기화에 넣기는 기각했다. 화면 상태라 기기마다 달라도 된다(사이드바 접힘·너비와 같음).

### ADR-079 · 2026-10-28 · 캔버스 — 펜 필기와 이미지·세션·페이지·보관함 가져오기
- 배경: 새로 만들기에서 손글씨를 쓰는 캔버스를 열고 싶다. 이미지, 대화 세션 내용, 페이지 내용, 보관함 항목을 가져와 그 위에 필기하고 싶다.
- 결정:
  - 저장:
    - 페이지(ADR-072)와 같은 문서 세션으로 저장한다. 세션은 `kind: 'canvas'`이고, 하나뿐인 문서 메시지 본문이 `CanvasDoc` JSON(`v:1`, `strokes`, `items`)이다.
    - 트리·동기화·삭제·백업 경로는 그대로 쓴다. 대화 기능은 `isDocSession`으로 막는다.
  - core `canvas.ts`(순수 함수):
    - `parseCanvas`는 잘못된 값을 버린다. 이미지는 png·jpeg·gif·webp data URL만 받는다.
    - `serializeCanvas`, `compactPoints`(점 줄이기·소수 1자리), `eraseStrokesAt`(획 단위 지우개).
    - 항목 추가·고치기(최소 24px)·지우기·앞으로, `canvasBounds`.
    - `sessionCardText`·`pageCardText`. 페이지의 첨부 data URL은 뺀다.
  - 맥락·요약·검색·학습 내보내기:
    - JSON 대신 `canvasText`를 쓴다. 카드 제목과 글, 이미지 이름, 획 수가 들어간다.
    - 그래서 base64가 맥락에 들어가지 않는다. 캔버스 부모의 가지에는 "부모 캔버스"로 넘긴다.
  - 동기화:
    - `page.new`의 `pageKind: 'canvas'`는 기능 `'canvas'`가 필요하다. 옛 PC에는 outdated로 처리한다.
    - `page.edit` 본문 상한은 `SYNC_LIMITS.doc`(8M자)이다. WebSocket 상한 16MB 안에 든다.
  - ui `canvas/*`:
    - 판의 확대·이동은 화면 변환으로 한다. 획은 perfect-freehand로 필압 윤곽을 만든다.
    - 도구는 펜·형광펜(multiply)·지우개·선택(이동·크기·앞으로)이다. 실행 취소·다시 실행은 손동작 한 번이 한 칸이고 100칸까지다.
    - 터치:
      - 두 손가락은 확대·이동이다.
      - 손바닥 거부: 펜이 닿아 있는 동안 들어온 터치는 버린다. 펜을 한 번 쓴 뒤에는 한 손가락 터치가 화면을 옮긴다. 펜보다 먼저 닿은 손바닥의 획은 펜이 닿을 때 버린다.
    - 그리는 중 획은 rAF마다 한 번 다시 그린다.
    - 가져오기:
      - [이미지]는 파일 고르기로 받는다(25MB 이하, 여러 장 가능). 긴 변 1600px로 줄인다.
      - [세션 내용]·[페이지 내용]·[보관함]은 고른 것을 글 카드로 넣는다. 보관함 그림은 그림으로 넣는다.
      - 원격 기기는 메시지를 PC에서 받아 온 뒤 넣는다.
    - 저장:
      - 0.5초 뒤 `updatePage`로 저장한다. 나갈 때, `pagehide`, 화면이 숨겨질 때 바로 저장한다.
      - 상한을 넘거나 저장이 실패하면 글을 대기시키고 한 번 알린다.
  - 만드는 곳: 학습 시작 화면의 [캔버스로 시작]·[캔버스], 사이드바 하위 [+]의 [캔버스]. 사이드바·마인드맵은 펜 아이콘을 쓴다.
- 대안:
  - `<canvas>` 비트맵 저장은 기각했다. 획 단위 지우개·실행 취소·확대 선명도가 없고, 동기화 크기도 크다. 벡터 획 JSON으로 대신한다.
  - 이미지를 보관함(IndexedDB) 참조로 두기는 기각했다. ADR-077과 같은 까닭이다. 크기 제한으로 대신한다.
  - 가져온 세션·페이지를 실시간으로 이어 두기(참조 카드)는 기각했다. 가져온 때의 사본으로 둔다. 출처 id는 `source`에 남긴다.
- 알려진 한계:
  - 같은 캔버스를 두 기기가 0.5초 안에 함께 고치면 나중에 저장한 쪽이 이긴다.
  - 항목 선택·이동은 포인터로만 한다(키보드는 Delete만).

### ADR-080 · 2026-10-28 · 캔버스 설정 — 판 크기(자유·가로형 16:9·세로형 9:16)와 쪽 넘김, 가져온 직후 선택 도구
- 배경: 캔버스를 끝없는 판 말고 슬라이드·공책처럼 정해진 크기의 쪽으로도 쓰고 싶다. 옆으로 넘기면 새 쪽이 나와야 한다. 가져온 그림이 펜으로 쓸 때 골라진 채로 남아 거슬린다.
- 결정:
  - core `CanvasDoc`에 선택 필드 `layout`(`'landscape'|'portrait'`, 없으면 자유)과 `pages`(1~200)를 더한다. 쪽 크기는 1600×900·900×1600, 쪽 사이 80px.
    - 쪽은 오른쪽으로 이어지고 첫 쪽 가운데가 원점이다. 자유 판에서 쓴 내용(원점 둘레)이 첫 쪽에 들어온다.
    - 판 모양을 바꿔도 내용 좌표는 그대로다. 쪽 밖 내용은 잘라 내지 않고 그대로 보인다.
    - `setCanvasLayout`·`addCanvasPage`·`canvasPageRect`·`canvasPageCount`. `canvasText`에 2쪽 이상이면 쪽 수를 적는다.
  - 판 모양·쪽 수는 설정이라 실행 취소 기록에 넣지 않는다. 되돌려도 지금 값을 지킨다.
  - ui:
    - 도구막대 [캔버스 설정](톱니) → 크기 고르기 대화상자.
    - 쪽 나눔 판은 한 번에 한 쪽을 맞춰 보여 준다. 화면 이동(터치 팬·두 손가락·선택 도구로 빈 곳 끌기·휠/트랙패드)이 끝나면, 쪽 가운데가 화면 너비의 15%(최대 80px) 넘게 왼쪽으로 밀렸으면 다음 쪽, 오른쪽이면 이전 쪽, 아니면 제자리로 0.2초 동안 맞춘다. 마지막 쪽에서 다음으로 넘기면 빈 쪽을 더한다.
    - 맞춤보다 15% 넘게 확대해 보고 있으면 쪽을 넘기지 않고 쪽 안을 자유롭게 움직인다.
    - 아래 가운데 쪽 넘김 막대: 이전 · n / 전체 · 다음(마지막 쪽이면 [새 쪽]). [전체 보기]는 쪽 나눔에서 [쪽 맞춤]이다.
  - 펜·형광펜·지우개를 고르면 항목 선택을 푼다. 항목의 이동 커서는 선택 도구에서만 보인다.
  - 이미지·세션·페이지·보관함을 가져온 직후에는 선택 도구로 바꾸고 가져온 항목을 고른다.
- 대안:
  - 쪽마다 따로 획·항목 배열을 두기는 기각했다. 한 좌표계에 쪽 사각형만 겹치면 이동·지우개·맥락 글이 그대로 동작하고, 판 모양을 오가도 내용이 사라지지 않는다.
  - 쪽 밖 획 자르기(clip)는 하지 않는다. 자유 판에서 바꾼 내용이 숨으면 잃어버린 것처럼 보인다.
- 알려진 한계:
  - 옛 버전 기기가 캔버스를 고쳐 저장하면 `layout`·`pages`가 빠져 자유 판으로 돌아간다(내용은 남는다).
  - 마지막 빈 쪽은 저절로 지우지 않는다.
- 추가(같은 날): 쪽 넘김 방향 — 옆으로 / 위아래로.
  - `CanvasDoc.flow`(`'vertical'`일 때만 저장, 없으면 옆으로)를 더한다. 위아래면 쪽이 아래로 이어진다(첫 쪽 가운데가 원점인 것은 같다).
  - 설정 대화상자에서 쪽 나눔 판일 때 [쪽 넘김 방향]을 고른다. 판 모양을 바꿔도 방향은 지키고, 자유 판으로 가면 버린다. 실행 취소 기록에 넣지 않는다.
  - 화면 이동이 끝나면 쪽 방향 축(위아래면 세로, 문턱은 화면 높이 기준)으로만 밀린 거리를 재어 넘긴다. 위로 밀면 다음 쪽, 아래로 밀면 이전 쪽. 쪽 넘김 막대 화살표도 위·아래로 바뀐다.

### ADR-081 · 2026-10-28 · 캔버스 PDF 모드 · A4 가로 · 바탕(색·바둑판·줄공책) · 잉크 색 즐겨찾기 · 펜 굵기 창 · 긴 카드 스크롤
- 배경: 세션·페이지·보관함 카드에 긴 글이 잘린다. 색은 흰색이 없고 원하는 색을 고를 수 없다. 굵기 단계 버튼이 자리를 차지한다. PDF 위에 필기하고 싶고, A4 가로와 공책 같은 바탕이 필요하다.
- 결정:
  - 카드(이미지 외 가져오기)는 본문을 `[data-canvas-scroll]` 상자로 감싸 넘치면 스크롤한다. 휠은 카드 안에서 스크롤할 수 있으면 카드에 주고, 터치는 선택 도구에서 카드 본문을 끌면 스크롤 제스처로 처리한다.
  - 도구막대
    - 색: 흰색을 더한다. [직접 고르기]는 색 코드 입력·색상 창이 있는 작은 창이고, 별 버튼으로 즐겨찾기(최대 8개)에 넣고 뺀다.
    - 굵기 단계 버튼을 없앴다. 펜·형광펜 버튼을 누르면 그 도구를 고르며 굵기 창(슬라이더+숫자, 펜 1~30 · 형광펜 4~60)이 뜬다. 버튼에 굵기 숫자 배지를 단다.
    - 즐겨찾기 색과 굵기는 기기별 설정(localStorage `octobooks.canvas.*`)이다. 캔버스 문서에 넣지 않는다.
    - 가져오기 아이콘은 범용 `Import`로 바꿨다.
  - PDF 가져오기
    - pdf.js(`pdfjs-dist`)를 처음 쓸 때만 동적 import한다. 워커·cmaps·표준 글꼴·wasm·icc는 Vite 플러그인(`packages/ui/vitePdfjs.ts`)이 `pdfjs/<dir>/`로 내보내고, `document.baseURI` 기준 상대 URL로 불러 데스크탑(file://)·모바일(Capacitor)·웹에서 같다.
    - 각 쪽을 그림(webp 0.82, 안 되면 jpeg 0.85)으로 바꿔 core `CanvasDoc.pdf`(`{name, pages:[{src,w,h}]}`)에 넣는다. 그림 긴 변은 쪽 수에 따라 1600/1200/900/700px, 캔버스 좌표 쪽 크기는 1pt=2px(한 변 최대 4000).
    - 최대 100쪽, 그림 합계는 600만 자와 (캔버스 저장 상한 − 지금 내용 − 여유) 중 작은 값까지. 넘으면 앞쪽만 가져오고 알린다(첫 쪽은 항상).
    - PDF를 가져오면 판이 `layout: 'pdf'`(쪽마다 PDF 크기, 쪽 추가 없음)로 바뀐다. 다른 판 크기로 바꾸거나 PDF를 바꾸면 확인을 받고 PDF를 버린다(필기는 남는다). 암호 PDF는 거절한다.
  - 판 크기에 A4 가로(1600×1131)를 더한다.
  - 바탕: core `CanvasDoc.bg`(`color?`, `pattern?: 'grid-fine'|'grid-wide'|'lines'`). 설정에서 색(종이·흰색·크림·연두·하늘·회색·칠판·직접)과 무늬(민무늬·바둑판 촘촘하게 20px·느슨하게 48px·줄공책 36px)를 고른다. CSS 배경으로 그리며 자유 판은 화면 이동을 따라간다. 어두운 색이면 무늬 선을 밝게 그린다.
  - 판 크기·쪽·방향·PDF·바탕은 모두 설정이라 실행 취소 기록에 넣지 않는다(`keepCanvasSettings`).
- 대안:
  - PDF 원본을 저장하고 매번 렌더하기는 기각했다. 동기화 문서 크기 상한 안에서 가볍게 다루고, 다른 기기에서 pdf.js 없이 바로 보이도록 그림으로 굳힌다.
  - 굵기 단계 버튼을 유지하는 대신 슬라이더 창으로 바꿨다(요청).
- 알려진 한계:
  - PDF 글자는 그림이 되어 선택·검색·맥락 글에 들어가지 않는다(맥락 글에는 `[PDF: 이름]`만 적는다).
  - 쪽이 많으면 그림 해상도가 낮아진다. 옛 버전 기기가 캔버스를 고쳐 저장하면 `pdf`·`bg`가 빠진다.

### ADR-082 · 2026-10-28 · A4 세로 · 카드 스크롤은 선택 도구에서만
- 배경: 판 크기에 A4 세로가 없다. 펜 도구로 긴 글 카드 위에 필기하면 획이 그려지지 않는다 — 카드 본문이 스크롤 상자(`overflow-y: auto`)라 판의 `touch-action: none`이 그 안까지 미치지 않아, 브라우저가 펜·터치를 스크롤로 가로채고 포인터를 취소한다.
- 결정:
  - 판 크기에 A4 세로(1131×1600, `'a4-portrait'`)를 더한다.
  - 카드 본문은 선택 도구일 때만 스크롤한다(`overflow-y-auto`, 그 밖에는 `overflow-hidden`). 휠·손가락·펜·스크롤 막대 모두 같다. 다른 도구에서는 휠이 판을 움직이고, 펜 이후 손가락은 판을 옮긴다.
  - 카드 본문은 항상 `touch-none`. 터치·펜 스크롤은 판이 직접 처리한다(ADR-081 그대로).

### ADR-083 · 2026-10-28 · 펜·형광펜 세부 조정은 두 번째 누름 · 펜 종류
- 배경: 펜·형광펜을 고를 때마다 굵기 창이 떠서 도구를 바꿀 때 거슬린다. 펜 모양도 한 가지뿐이다.
- 결정:
  - 다른 도구에서 펜·형광펜을 누르면 고르기만 한다. 이미 고른 펜·형광펜을 다시 누르면 세부 조정 창을 열고, 한 번 더 누르면 닫는다.
  - 펜 종류: 만년필(기본)·볼펜·붓펜·연필. core `CanvasStroke.nib`에 획마다 저장한다(펜 획에서만, 만년필은 생략해 옛 데이터와 같다). perfect-freehand 옵션을 종류별로 바꾼다: 볼펜은 굵기 변화가 거의 없고, 붓펜은 굵기 변화가 크고 양 끝이 가늘며 압력이 없는 입력에서도 속도로 굵기를 흉내 낸다. 연필은 가늘게 변하고 불투명도 0.8.
  - 펜 창에는 종류 고르기(radiogroup)와 굵기가 함께 있고, 미리보기는 고른 종류의 실제 획 모양으로 그린다. 펜 단추 아이콘도 종류를 따른다. 고른 종류는 기기 설정(`octobooks.canvas.penNib`)으로 남는다.
- 알려진 한계: 옛 버전 기기는 `nib`를 모르고 만년필로 그린다(획 자체는 남는다).

### ADR-084 · 2026-10-28 · 캔버스·페이지 전체 화면
- 배경: 캔버스·마크다운 페이지는 넓을수록 쓰기 좋은데, 상단 바(마인드맵·검색·설정 행)와 사이드바가 늘 자리를 차지한다.
- 결정:
  - 단일 보기(main 패널)의 캔버스·페이지 헤더 우측에 전체 화면 버튼(`Maximize2`/`Minimize2`, `data-panel-full`). 누르면 상단 바와 사이드바를 숨기고 패널만 보인다. 다시 누르면 되돌린다.
  - 상태는 `useUi.panelFull`(일시 상태, 저장하지 않음). 활성 세션이 캔버스·페이지가 아니게 되거나 마인드맵·분할 보기로 가면 저절로 풀린다.
  - Esc 단축키는 두지 않는다 — 캔버스·페이지 편집기가 이미 Esc를 쓴다.
