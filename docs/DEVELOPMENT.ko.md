# 개발 안내

[English](DEVELOPMENT.md) | **한국어**

소스에서 OctoBooks를 빌드·실행·배포하는 방법입니다. [README로 돌아가기](../README.ko.md)

## 요구 사항

- Node.js 22 이상, pnpm 10 (`corepack enable`)
- 선택: 공식 `claude` / `codex` CLI(구독 연결), Xcode(iOS), Android Studio(Android)

```bash
git clone https://github.com/lafin716/octobooks.git
cd octobooks
pnpm install
```

## 구조

| 경로 | 내용 |
|---|---|
| `packages/core` | 도메인 모델·앵커·맥락 구성·트리, Zustand 스토어, Provider 인터페이스 (플랫폼 무관) |
| `packages/ui` | Vite + React + Tailwind SPA (모든 플랫폼 공유, 웹 빌드 산출물) |
| `packages/bridge` | 공식 CLI 실행 + WebSocket 서버 (데스크톱 내장 / 헤드리스) |
| `packages/server` | `octobooks serve` — 데스크톱 앱 없이 도는 헤드리스 호스트 |
| `packages/relay` | 아웃바운드 WebSocket 중계 (페이로드 E2E 암호화) |
| `apps/desktop` | Electron (main 프로세스에 bridge 내장) |
| `apps/mobile` | Capacitor (iOS/Android) |
| `e2e/` | Playwright E2E + 모의 Anthropic SSE 서버 |

## 웹

```bash
pnpm dev          # http://0.0.0.0:5173 (LAN·Tailscale *.ts.net 접속 허용)
```

- 휴대폰: 같은 와이파이에서 `http://<PC LAN IP>:5173`, Tailscale이면 `http://<호스트명>.<tailnet>.ts.net:5173`
- 시작 화면에서 프로필을 고릅니다: **이 기기**(IndexedDB + API 키) 또는 페어링한 PC(미러링). 개발 서버에서 `?platform=desktop`을 붙이면 데스크톱 로컬 모드로 동작합니다.
- 데모 모드: 개발 서버의 시나리오 메뉴(또는 `#scenario=home` 등)로 Mock provider·시드 데이터 화면을 봅니다.
- 정적 빌드: `pnpm --filter @branch/ui build` → `packages/ui/dist/`를 정적 호스팅에 올리면 됩니다. 미리보기 `pnpm --filter @branch/ui preview`.
- 빌드 시 환경 변수(선택):
  - `VITE_GOOGLE_CLIENT_ID` — 구글 드라이브 백업용 OAuth 클라이언트 ID (없으면 모의 드라이브)
  - `VITE_ANTHROPIC_BASE_URL`, `VITE_OPENAI_BASE_URL` — API 엔드포인트 변경(프록시·테스트용)

## 데스크톱 (Electron)

```bash
pnpm dev                                   # 터미널 1: Vite 개발 서버
pnpm --filter @branch/desktop dev          # 터미널 2: Electron (개발 서버 로드)

pnpm --filter @branch/desktop build        # 렌더러 + main 번들 → apps/desktop/dist
pnpm --filter @branch/desktop start        # 빌드 결과 실행
```

패키징 (electron-builder, 결과물은 `apps/desktop/release/`):

```bash
pnpm --filter @branch/desktop package:dir  # 앱 폴더만 (빠른 확인) → release/mac-arm64/OctoBooks.app
pnpm --filter @branch/desktop package      # 현재 OS용: mac dmg/zip · win nsis · linux AppImage/deb
```

- 다른 OS용 설치본은 해당 OS(또는 CI 러너)에서 만드는 것을 권장합니다.
- 코드 서명/공증은 기본 설정되어 있지 않습니다(BLOCKERS B-03). macOS에서 서명 없이 빌드하려면 `CSC_IDENTITY_AUTO_DISCOVERY=false`. 서명하려면 `CSC_LINK`/`CSC_KEY_PASSWORD`(+ 공증 `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)를 CI 비밀 값으로 등록합니다.
- **백그라운드 실행**: 원격 페어링이 켜져 있으면 창을 닫아도 트레이(메뉴 막대)에 남아 페어링된 휴대폰·웹이 계속 동작합니다. 완전히 끄려면 트레이 메뉴 [완전 종료] (macOS는 ⌘Q).
- 데스크톱은 bridge를 내장하므로 PC에 설치·로그인된 `claude` / `codex` CLI를 바로 씁니다. API 키는 OS 보안 저장소(safeStorage)에 저장됩니다.

## 모바일 (Capacitor)

```bash
pnpm --filter @branch/mobile build:android   # Android debug APK (Android Studio/SDK 필요)
pnpm --filter @branch/mobile build:ios-sim   # iOS 시뮬레이터 빌드 (Xcode, 서명 없음)
pnpm --filter @branch/mobile android         # Android Studio로 열기
pnpm --filter @branch/mobile ios             # Xcode로 열기
```

- API 키로 휴대폰 단독으로 쓰거나, PC와 페어링해 PC의 학습을 그대로 보고 PC의 CLI로 답을 받습니다.
- 페어링: PC 앱 설정 › 연결 › [원격 페어링 열기] → [휴대폰·웹 연결] → 휴대폰에서 **[QR 스캔]**, 또는 링크·주소 + 6자리 코드 입력. OS 카메라로 찍으면 `branch://pair` 딥링크로 앱이 열립니다.
- 스토어 배포·서명은 BLOCKERS B-07.

## 헤드리스 호스트 `octobooks serve`

서버(PC)에서 데스크톱 앱 대신 실행하면 모바일·웹 앱이 데스크톱과 똑같이 페어링해 씁니다. 학습·질문·가지·요약·서식이 동기화되고, 답변은 그 PC의 claude/codex CLI(또는 API 키)로 만들어집니다.

```bash
pnpm octobooks -- serve --pair          # 빌드 후 실행. :7777, QR·링크·1회용 코드(5분) 표시
pnpm octobooks -- serve                 # 이미 페어링한 기기만 접속
pnpm octobooks -- devices               # 페어링된 기기 목록
pnpm octobooks -- unpair <id|all>       # 해제 (실행 중인 serve는 다시 시작해야 끊김)
# 빌드 산출물 하나로도 실행: node packages/server/dist/rhymebook.cjs serve --pair
```

저장소 루트의 실행 스크립트는 처음 실행 때 의존성을 설치하고, 실행할 때마다 서버를 다시 빌드합니다(1~2초, `RHYMEBOOK_NO_BUILD=1`이면 건너뜀). 인자가 없으면 `serve`, 옵션으로 시작하는 인자를 주면 앞에 `serve`를 붙입니다.

```bash
./rhymebook.sh --pair          # macOS·Linux (= serve --pair)
./rhymebook.sh devices
rhymebook.cmd --pair           # Windows (탐색기에서 더블클릭하면 serve)
```

| 옵션 | 내용 |
|---|---|
| `--port` / `--host` | 기본 `7777`(`RHYMEBOOK_PORT`) / `0.0.0.0` |
| `--name` | 앱에 보일 이름 (처음 실행 때 컴퓨터 이름으로 정해져 저장) |
| `--dir` | 데이터 폴더 (기본 `$RHYMEBOOK_HOME` → `~/.config/rhymebook`, Windows `%APPDATA%\rhymebook`) |
| `--agent auto\|claude-cli\|codex-cli` | 새 학습 에이전트 (auto: 준비된 claude → codex → API 키 순) |
| `--no-delete` | 원격 기기의 학습·질문 삭제 막기 |
| `--relay <url>` / `--relay-only` | NAT 뒤에서 relay로 접속 받기 |
| `--whisper-cli <경로>` | 음성 입력에 쓸 whisper-cli (기본: `BRANCH_WHISPER_CLI` → PATH·Homebrew) |
| `-v` | 자세한 로그 |

- 데이터 폴더: `data.json`(학습, 0600), `skills/<이름>/SKILL.md`, `bridge/`(페어링 정보), `stt/`(음성 설정·모델).
- API 키는 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 환경변수로 줍니다(메모리에만 보관, 파일·로그에 남지 않음).
- 데스크톱 앱과 데이터를 공유하지 않습니다(별개 호스트). Ctrl+C로 끄면 진행 중 답변을 멈추고 저장한 뒤 종료합니다.

## 헤드리스 Bridge · Relay

CLI가 로그인된 PC에서 bridge만 띄우고, 데스크톱 앱의 "다른 PC에 연결"로 그 PC의 CLI를 씁니다.

```bash
pnpm bridge -- --pair                 # :7777, QR·링크·1회용 코드(5분)
pnpm bridge -- devices
pnpm bridge -- unpair <id|all>

pnpm relay                                                          # relay :8787
pnpm bridge -- --pair --relay ws://<relay 호스트>:8787                # 직접 + relay
pnpm bridge -- --pair --relay wss://relay.example.com --relay-only   # 포트를 열지 않음
```

- 앱에 보이는 bridge 지문이 터미널 지문과 같은지 확인하세요.
- relay는 암호문만 중계합니다. 공개 배포 시 TLS 프록시(Caddy/nginx) 뒤에서 `wss://`로 운영하세요(B-09).

## Provider와 정책

| Provider | 쓰는 곳 | 비고 |
|---|---|---|
| Anthropic API / OpenAI API | 모든 플랫폼 | 본인 API 키(BYOK). 공개 배포의 기본 provider |
| Claude CLI / Codex CLI | 데스크톱, 헤드리스 bridge·호스트 | 사용자 본인이 로그인한 **공식 CLI 실행**만 사용. 도구 제한(읽기 전용), 매 호출 무상태 |
| 원격 Bridge | 데스크톱 | 페어링된 bridge 경유(직접 또는 relay) |
| PC 원격 학습 | 웹·모바일 | PC 스토어 미러링, CLI는 PC가 실행 |
| Mock | 데모 모드 | 가짜 스트리밍 |

- OAuth 토큰·인증 파일을 읽거나 추출하지 않으며, 클라이언트 헤더를 위조하지 않습니다. 로그인 여부는 CLI 공식 상태 명령으로만 확인합니다.
- 구독 연결은 본인 기기의 본인 CLI로 한정합니다(다른 사람과 구독 공유 금지).
- API 키·페어링 키는 OS 보안 저장소에만 저장합니다(웹은 탭 메모리 전용). 로그·커밋·relay 평문에 남기지 않습니다.

## 개발

```bash
pnpm typecheck && pnpm lint && pnpm test     # 타입체크 · ESLint · Vitest

pnpm exec playwright install chromium        # 최초 1회
pnpm e2e                                     # Playwright E2E (데스크톱 1440×900 · 모바일 390×844)
```

E2E는 모의 Anthropic SSE 서버(`e2e/mock-anthropic.mjs`, :8799)와 Vite(:5191)를 자동으로 띄웁니다. 실제 API 키는 필요 없습니다.

앱 아이콘: 원본은 `assets/icon/glyph.svg`입니다. `node scripts/gen-icons.mjs`로 데스크톱·iOS·Android·웹 아이콘을 다시 만듭니다.

### CI / 릴리스 (GitHub Actions)

- `.github/workflows/ci.yml` — push(main)·PR: 타입체크·린트·단위 테스트, Playwright E2E.
- `.github/workflows/release.yml` — 태그 `v*` 또는 수동 실행: macOS·Windows·Linux 러너가 데스크톱 설치본, ubuntu가 Android debug APK를 만들고, 태그면 초안 GitHub Release에 첨부합니다.
- 서명: 저장소 secrets(`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`)가 있을 때만 적용됩니다. 인증서를 저장소에 커밋하지 마세요(B-10).

## 이름과 호환성

프로젝트는 **Branch Learn**으로 시작해 **rhymebook**을 거쳐 v0.20.0부터 **OctoBooks**가 되었습니다(저장소: `lafin716/octobooks`). 기존 앱을 업데이트하면 학습 기록·설정·API 키가 유지됩니다. 호환을 위해 앱 ID, 데스크톱 데이터 폴더(`<appData>/rhymebook`), `branch://` 페어링 링크, `@branch/*` 패키지, `RHYMEBOOK_*` 환경변수, `rhymebook` CLI 별칭, 백업 형식은 그대로입니다. 리브랜딩 기록: [docs/rebrand/](rebrand).

