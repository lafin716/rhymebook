# Branch Learn (가칭) — 가지치기 학습 채팅앱

답변 속 모르는 단어·문장을 드래그해 **서브세션(가지)** 으로 질문하고, 부모 맥락을 상속받아 설명을 듣고, 이해한 내용을 **요약 카드**로 부모에 되돌리는 학습용 채팅앱입니다.
분할 패널 · 플로팅 팝업(모바일은 바텀시트) · 마인드맵으로 세션 트리를 볼 수 있습니다.

- 설계 문서: [`docs/`](docs) (비전 · PRD · 아키텍처 · Provider · UX · 로드맵 · 진행 현황 · ADR · 블로커)
- 지원: 웹 · 데스크톱(macOS/Windows/Linux, Electron) · 모바일(iOS/Android, Capacitor)

## 요구 사항

- Node.js 22 이상, pnpm 10 (`corepack enable`)
- 선택: 공식 `claude` / `codex` CLI(구독 연결), Xcode(iOS), Android Studio(Android)

```bash
pnpm install
```

## 구조

| 경로 | 내용 |
|---|---|
| `packages/core` | 도메인 모델·앵커·맥락 구성·트리, Zustand 스토어, Provider 인터페이스 (플랫폼 무관) |
| `packages/ui` | Vite + React + Tailwind SPA (모든 플랫폼 공유, 웹 빌드 산출물) |
| `packages/bridge` | 공식 CLI 실행 + WebSocket 서버 (데스크톱 내장 / 헤드리스) |
| `packages/relay` | 아웃바운드 WebSocket 중계 (페이로드 E2E 암호화) |
| `apps/desktop` | Electron (main 프로세스에 bridge 내장) |
| `apps/mobile` | Capacitor (iOS/Android) |
| `e2e/` | Playwright 핵심 플로우 E2E + 모의 Anthropic SSE 서버 |

## 웹

```bash
pnpm dev          # http://0.0.0.0:5173 (LAN·Tailscale *.ts.net 접속 허용)
```

- 휴대폰: 같은 와이파이에서 `http://<PC LAN IP>:5173`, Tailscale이면 `http://<호스트명>.<tailnet>.ts.net:5173`
- 데모 모드: 개발 서버에서 상단 시나리오 메뉴(또는 `#scenario=home` 등)로 Mock provider·시드 데이터 화면을 바로 볼 수 있습니다. [실제 모드로]를 누르면 실제 provider와 IndexedDB 저장을 씁니다.
- 정적 빌드: `pnpm --filter @branch/ui build` → `packages/ui/dist/` 를 아무 정적 호스팅에 올리면 됩니다. 미리보기 `pnpm --filter @branch/ui preview`.
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
pnpm --filter @branch/desktop package:dir  # 설치본 없이 앱 폴더만 (빠른 확인)
pnpm --filter @branch/desktop package      # 현재 OS용: mac dmg/zip · win nsis · linux AppImage/deb
```

- 다른 OS용 설치본은 해당 OS(또는 CI 러너)에서 만드는 것을 권장합니다.
- 코드 서명/공증은 설정되어 있지 않습니다(BLOCKERS B-03). 서명 없이 빌드하려면 macOS에서 `CSC_IDENTITY_AUTO_DISCOVERY=false` 를 붙이세요. 서명하려면 `CSC_LINK`/`CSC_KEY_PASSWORD`(+ macOS 공증 `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)를 CI 비밀 값으로 등록합니다.
- 데스크톱은 bridge를 내장하므로 PC에 설치·로그인된 `claude` / `codex` CLI를 바로 씁니다. API 키는 OS 보안 저장소(safeStorage)에 저장됩니다.

## 모바일 (Capacitor)

```bash
pnpm --filter @branch/mobile build:android   # Android debug APK (Android Studio/SDK 필요)
pnpm --filter @branch/mobile build:ios-sim   # iOS 시뮬레이터 빌드 (Xcode, 서명 없음)
pnpm --filter @branch/mobile android         # Android Studio로 열기
pnpm --filter @branch/mobile ios             # Xcode로 열기
```

- 모바일에는 CLI가 없으므로 API 키(보안 저장소) 또는 **원격 Bridge** 로 연결합니다.
- 페어링: 설정 › 원격 Bridge › 페어링 시작에서 **[QR 스캔]** 으로 bridge 화면의 QR을 찍거나, OS 카메라로 찍어 `branch://pair` 딥링크로 앱을 열 수 있습니다(카메라 권한 필요, Android 8.0+).
- 스토어 배포·서명은 BLOCKERS B-07.

## 이해 노트 (내보내기)

상단 바의 **이해 노트** 아이콘을 누르면 현재 세션 트리의 가지(앵커 원문 + 요약)를 한눈에 보고 내보낼 수 있습니다.

- **Markdown 저장** — 가지 계층을 헤딩으로, 원문 인용 속 앵커를 굵게, 요약을 "이해한 내용"으로 정리합니다.
- **Anki 카드** — Anki › 파일 › 가져오기로 불러오는 TSV(앞면 = 앵커·문맥·경로, 뒷면 = 요약). 요약을 붙인 가지만 카드가 됩니다.
- 모바일 앱에서는 공유 시트로 파일을 저장·전송합니다.

## 앱 아이콘

원본은 `assets/icon/glyph.svg` 입니다. 바꾼 뒤 `node scripts/gen-icons.mjs` 를 실행하면 데스크톱(`apps/desktop/build/icon.png`), iOS·Android 앱 아이콘, 웹 favicon을 다시 만듭니다(Playwright Chromium 사용).

## 헤드리스 Bridge (원격 CLI 사용)

CLI가 로그인된 PC에서 bridge를 띄우고, 웹/모바일에서 페어링해 그 PC의 CLI를 씁니다.

```bash
pnpm bridge -- --pair                 # :7777, QR·링크·1회용 코드(5분) 표시
pnpm bridge -- devices                # 페어링된 기기 목록
pnpm bridge -- unpair <id|all>        # 페어링 해제
```

- 앱: 설정 › 연결 › 원격 Bridge › 페어링 시작 → 링크 붙여넣기 또는 주소 + 코드 입력. 앱에 보이는 bridge 지문이 터미널 지문과 같은지 확인하세요.
- 같은 LAN 또는 Tailscale에서 TCP 7777로 직접 접속합니다.

### Relay (NAT 뒤 bridge)

```bash
pnpm relay                                                     # :8787
pnpm bridge -- --pair --relay ws://<relay 호스트>:8787           # 직접 + relay
pnpm bridge -- --pair --relay wss://relay.example.com --relay-only   # 포트를 열지 않음
```

- relay는 암호문만 중계합니다(페이로드 E2E 암호화). 공개 배포 시 TLS 프록시(Caddy/nginx) 뒤에서 `wss://` 로 운영하세요(B-09).

## Provider와 정책

| Provider | 쓰는 곳 | 비고 |
|---|---|---|
| Anthropic API / OpenAI API | 모든 플랫폼 | 본인 API 키(BYOK). 공개 배포의 기본 provider |
| Claude CLI / Codex CLI | 데스크톱, 헤드리스 bridge | 사용자 본인이 로그인한 **공식 CLI 실행**만 사용. 도구 비활성/읽기 전용 샌드박스, 매 호출 무상태 |
| 원격 Bridge | 웹·모바일 | 페어링된 bridge 경유(직접 또는 relay) |
| Mock | 데모 모드 | 가짜 스트리밍 |

- OAuth 토큰·인증 파일을 읽거나 추출하지 않으며, 클라이언트 헤더를 위조하지 않습니다. 로그인 여부는 CLI 공식 상태 명령으로만 확인합니다.
- 구독 연결은 본인 기기의 본인 CLI로 한정합니다(다른 사람과 구독 공유 금지).
- API 키·페어링 키는 OS 보안 저장소에만 저장합니다(웹은 탭 메모리 전용 — 새로고침 시 다시 입력). 로그·커밋·relay 평문에 남기지 않습니다.

## 검증

```bash
pnpm typecheck && pnpm lint && pnpm test     # 타입체크 · ESLint · Vitest (core/ui/bridge/relay)

pnpm exec playwright install chromium        # 최초 1회
pnpm e2e                                     # Playwright E2E (데스크톱 1440×900 · 모바일 390×844)
```

E2E는 모의 Anthropic SSE 서버(`e2e/mock-anthropic.mjs`, :8799)와 Vite(:5191)를 자동으로 띄워 키 확인 → 3단계 가지 → 요약 붙이기 → 새로고침 유지, 분할·마인드맵·검색, 데모 시나리오 렌더, 이해 노트 Markdown·Anki 내보내기를 확인합니다. 실제 API 키는 필요 없습니다.

## CI / 릴리스 (GitHub Actions)

- `.github/workflows/ci.yml` — push(main)·PR: 타입체크·린트·단위 테스트, Playwright E2E(실패 시 trace 아티팩트).
- `.github/workflows/release.yml` — 태그 `v*` 또는 수동 실행: macOS·Windows·Linux 러너가 각 OS용 데스크톱 설치본, ubuntu가 Android debug APK를 만들고, 태그면 초안 GitHub Release에 첨부합니다.
- 서명: 저장소 secrets(`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`)가 있을 때만 적용되고, 없으면 미서명으로 빌드합니다. 인증서를 저장소에 커밋하지 마세요(B-10).

## 문서

진행 현황은 [`docs/PROGRESS.md`](docs/PROGRESS.md), 사람의 조치가 필요한 항목은 [`docs/BLOCKERS.md`](docs/BLOCKERS.md), 설계 결정은 [`docs/DECISIONS.md`](docs/DECISIONS.md)를 보세요.
