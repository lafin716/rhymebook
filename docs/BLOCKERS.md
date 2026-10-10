# Blockers — 사람의 조치가 필요한 항목

형식: ID · 항목 · 영향 Phase · 현재 우회 방법 · 해제 조건(사람이 할 일)

| ID | 항목 | Phase | 우회 | 해제 조건 |
|---|---|---|---|---|
| B-01 | Google OAuth 클라이언트 ID(웹/데스크톱/모바일) 미등록 | 2.5 | 클라이언트 ID가 없으면 구글 드라이브 대상이 IndexedDB 모의 드라이브로 동작(연결·백업·복원 검증), 실제 Drive 대상은 단위 테스트(fetch 모의) | Google Cloud 콘솔에서 OAuth 클라이언트 생성(`drive.appdata` 범위), 승인된 원본에 배포 도메인 추가 후 `VITE_GOOGLE_CLIENT_ID` 설정 |
| B-02 | 실제 Anthropic/OpenAI API 키로 최종 확인 | 1 | 로컬 모의 SSE 서버(Anthropic 형식)로 키 확인·스트리밍·가지 3단계·요약·분할·마인드맵 검증 완료 | 개발 서버 실제 모드(데모 바 [실제 모드로])에서 설정 › 연결에 본인 키 입력 후 질문 1회 |
| B-03 | 데스크톱 코드 서명·공증(macOS Developer ID, Windows 코드 서명 인증서) | 3·7 | 서명 없이 개발 실행(`pnpm --filter @branch/desktop dev`/`start`), 미서명 패키지(`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @branch/desktop package`). 배포본은 Gatekeeper/SmartScreen 경고 | Apple Developer ID 인증서 + 공증 자격증명, Windows 서명 인증서를 CI 비밀 값으로 등록 |
| B-04 | 다른 기기에서 CLI 설치·로그인 | 3 | 이 개발 머신은 claude/codex 모두 로그인 상태로 실제 스트리밍 검증 완료. 미설치·미로그인 안내는 가짜 CLI로 검증 | 사용 기기에서 `npm i -g @anthropic-ai/claude-code && claude auth login`, `npm i -g @openai/codex && codex login` |
| B-05 | @branch/bridge npm 미배포 (`npx @branch/bridge --pair` 불가) | 4 | 저장소에서 `pnpm bridge -- --pair`로 헤드리스 bridge 실행 | npm 계정·패키지 이름 확보 후 `pnpm --filter @branch/bridge publish` |
| B-06 | 원격 접속 네트워크 (Tailscale/LAN, 방화벽, https 출처의 ws:// 차단) | 4·6 | 같은 머신·Tailscale http 개발 서버에서 검증. https 호스팅 웹은 relay(Phase 6) 또는 wss 필요 | PC·휴대폰에 Tailscale 설치·로그인(또는 같은 LAN), 방화벽에서 TCP 7777 허용, 필요 시 리버스 프록시로 wss 제공 |
| B-07 | 앱스토어 배포(Apple Developer 계정·서명 인증서·프로비저닝, Google Play 콘솔·업로드 키) | 5 | 서명 없이 시뮬레이터 빌드(`CODE_SIGNING_ALLOWED=NO`)와 Android debug APK로 검증 | Xcode에서 Team 지정 후 Archive, Android `release` keystore 생성 후 `bundleRelease`, 각 스토어 등록 |
| B-08 | 실기기 테스트(iPhone/Android 폰) | 5 | 에뮬레이터·시뮬레이터에서 실행·보안 저장소·딥링크·페어링 확인 | 기기에 개발 빌드 설치 후 OS 카메라로 bridge QR 스캔 → 앱 열림·페어링 확인 |
| B-09 | relay 공개 배포(서버·도메인·TLS 인증서) | 6 | 로컬 relay(`pnpm relay`, 127.0.0.1:8787)와 `--relay-only` bridge(들어오는 포트 없음 = NAT 모의)로 웹 → relay → bridge → Claude CLI 실제 스트리밍 검증 | 공개 서버(VPS 등)에 `branch-relay` 실행 + Caddy/nginx로 `wss://relay.<도메인>` TLS 종료, bridge를 `--relay wss://relay.<도메인>`으로 실행 |
| B-10 | GitHub 저장소·Actions secrets 미설정 (로컬 저장소에 remote 없음) | 개선 | 워크플로는 actionlint로 검증, 같은 명령(`pnpm typecheck/lint/test/e2e`, desktop `package`, `build:android`)을 로컬에서 실행해 통과 | GitHub 저장소 생성 후 `git remote add origin … && git push`. 서명 시 Settings › Secrets에 `MAC_CSC_LINK`·`MAC_CSC_KEY_PASSWORD`·`APPLE_ID`·`APPLE_APP_SPECIFIC_PASSWORD`·`APPLE_TEAM_ID`·`WIN_CSC_LINK`·`WIN_CSC_KEY_PASSWORD` 등록, `git tag v0.1.0 && git push --tags`로 릴리스 |

예상 항목(발생 시 위 표로 이동): (없음)
