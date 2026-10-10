# 03 · Providers — 추상화, CLI/Bridge/Relay 설계, 정책

## 정책 원칙 (반드시 준수)

1. **공식 CLI 실행만 허용한다.** OAuth 토큰/세션 파일(`~/.claude/*`, `~/.codex/auth.json` 등)을
   읽거나 추출·복사·전송하지 않는다. 클라이언트 식별 헤더(User-Agent, `anthropic-beta`, 앱 식별자 등)를
   위조해 구독 엔드포인트를 직접 호출하지 않는다.
2. **구독 연결은 사용자 본인 CLI 경유로 한정한다.** 사용자가 자기 기기에 설치·로그인한 `claude`/`codex` CLI를
   그 기기(또는 본인이 페어링한 본인 기기의 bridge)에서 실행할 뿐이다. 다른 사람의 구독을 공유하는 기능을 만들지 않는다.
3. **공개 배포 시 기본 provider는 API 키(BYOK)** 이다. CLI provider는 사용자가 명시적으로 켠다.
4. 앱은 히스토리와 브랜치 맥락을 **소유**하고, CLI는 **매 호출 무상태**로 사용한다(CLI 세션 resume 미사용).
5. CLI는 **도구 비활성/읽기 전용 샌드박스**로 실행한다. 사용자 파일을 수정할 수 없어야 한다.
6. API 키·페어링 키는 OS 보안 저장소에만 저장하며, 로그·relay에 평문으로 남기지 않는다.

이 원칙에 반하는 기능 요청은 DECISIONS.md에 거절 근거와 함께 기록한다.

## 인터페이스

```ts
interface ChatTurn { role: 'user' | 'assistant'; content: string }

interface StreamRequest {
  system: string;
  messages: ChatTurn[];
  model?: string;
  signal?: AbortSignal;
}

type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; error: ProviderError };

type Availability =
  | { status: 'ready' }
  | { status: 'not-installed' | 'not-logged-in' | 'no-key' | 'offline' | 'unpaired'; detail?: string };

interface LLMProvider {
  id: string;                 // 'mock' | 'anthropic-api' | 'openai-api' | 'claude-cli' | 'codex-cli' | 'remote-bridge'
  label: string;
  available(): Promise<Availability>;
  stream(req: StreamRequest): AsyncIterable<StreamEvent>;
}
```
- `ProviderError { code: 'auth' | 'rate-limit' | 'network' | 'offline' | 'cli' | 'aborted' | 'unknown'; message; retryable }`
- `ProviderRegistry`: 등록, 세션별 선택, **fallback 순서** 적용(`offline`/`network` 오류 시 다음 provider로 자동 재시도, UI에 표시).
- 요약/제목 생성도 같은 `stream()`을 사용한다(별도 system 프롬프트).

## 구현체

| Provider | 동작 | 플랫폼 | Phase |
|---|---|---|---|
| MockProvider | 시드 기반 가짜 스트리밍. 지연/오류/오프라인 시나리오 주입 가능. 이후 **데모 모드**로 유지 | 전체 | 프로토타입 |
| AnthropicApiProvider | Messages API SSE 스트리밍(`anthropic-dangerous-direct-browser-access` 헤더로 브라우저 직접 호출, BYOK) | 전체 | 1 |
| OpenAIApiProvider | Chat Completions/Responses 스트리밍(BYOK) | 전체 | 1 |
| ClaudeCliProvider | bridge가 `claude -p --output-format stream-json --verbose`를 spawn. 도구 비활성(`--tools ""` 또는 `--disallowedTools` 전체), system은 `--system-prompt`, 대화는 stdin으로 직렬화 | 데스크톱/원격 | 3 |
| CodexCliProvider | bridge가 `codex exec --json --sandbox read-only --skip-git-repo-check` 실행(또는 app-server) | 데스크톱/원격 | 3 |
| RemoteBridgeProvider | 원격 bridge에 WebSocket 연결 후 위 CLI provider를 대리 호출 | 웹/모바일 | 4, 6 |

CLI 플래그는 Phase 3에서 설치된 CLI의 `--help`로 재확인하고 DECISIONS.md에 확정값을 기록한다.

### CLI 상태 감지 (bridge)
- 설치: `which claude` / `claude --version` 성공 여부
- 로그인: CLI가 제공하는 공식 상태 명령(예: `claude auth status`, `codex login status`) 또는
  최소 프롬프트 1회 실행 결과의 인증 오류 여부로 판단. **인증 파일을 직접 읽지 않는다.**
- 결과: `not-installed` / `not-logged-in` / `ready` + 버전 문자열, UI 안내 문구 매핑

## Bridge 설계 (packages/bridge)

- Node/TS 단일 패키지. 두 가지 모드:
  - **embedded**: Electron main에서 import, renderer와 IPC(또는 127.0.0.1 WS)로 통신
  - **headless**: `branch-bridge serve --port 7777` CLI로 실행(원격 접속용)
- 프로토콜(JSON over WS, 메시지 단위):
  - `hello {deviceId, sig}` → `welcome {bridgeId, providers}`
  - `status.get` → `status {providers: Availability[]}`
  - `chat.start {reqId, providerId, system, messages, model}` → `chat.delta {reqId, text}`* → `chat.done|chat.error`
  - `chat.abort {reqId}`
- 동시 실행 제한(기본 2), 요청 타임아웃, 프로세스 kill on abort.

### 페어링 (Phase 4)
- bridge 최초 실행 시 Ed25519 키쌍 생성. QR = `branch://pair?u=<ws url>&b=<bridgePubKey>&t=<1회용 토큰>`.
- 클라이언트는 기기 키쌍 생성 → 1회용 토큰으로 `pair` 요청 → bridge가 기기 공개키를 허용 목록에 저장.
- 이후 연결은 챌린지-서명으로 인증. 기기 해제는 bridge 측 목록에서 삭제.
- 직접 연결 경로: LAN IP 또는 Tailscale(100.x / MagicDNS). TLS가 없는 LAN은 페이로드 E2E 암호화로 보호.

## Relay 설계 (packages/relay, Phase 6)

- NAT 뒤 bridge가 relay로 **아웃바운드** WS 연결(`/b/<bridgeId>`) → 클라이언트는 `/c/<bridgeId>`로 접속, relay는 텍스트 프레임에 채널 번호만 붙여 중계(`{t:'open'|'data'|'close', ch, d}`).
- relay는 **암호문만** 본다: 클라이언트↔bridge 사이에 직접 연결과 동일한 핸드셰이크(X25519 임시 키 + Ed25519 서명)와 XChaCha20-Poly1305 프레임이 흐른다. 페어링 토큰·기기 인증도 암호 채널 안에서만 오간다.
- relay는 상태 없음(bridgeId → 제어 소켓 매핑만 메모리), 페이로드를 저장·기록하지 않는다. bridge 등록은 relay nonce에 bridge 신원 키로 서명(bridgeId = 공개키 해시이므로 별도 등록 토큰 불필요, ADR-020). 클라이언트 인증은 bridge가 기존대로 수행.
- 클라이언트 연결 우선순위: 직접(LAN/Tailscale, relay가 있으면 3초 제한) → relay → fallback provider(API 키 등). 마지막으로 성공한 경로를 다음 연결에 먼저 쓴다.
- 페어링 링크: `branch://pair?u=<직접>&r=<relay>&b=&t=`. relay 전용(`--relay-only`)이면 `u`가 relay 주소.
- 실행: `pnpm relay -- --port 8787` (공개 배포 시 TLS 프록시 뒤 wss://), `pnpm bridge -- --pair --relay wss://relay.example.com [--relay-only]`.
