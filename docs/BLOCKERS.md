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
| B-07 | 앱스토어 배포(Apple Developer 계정·서명 인증서·프로비저닝, Google Play 콘솔·업로드 키) | 5 | 서명 없이 시뮬레이터 빌드(`CODE_SIGNING_ALLOWED=NO`)와 Android debug APK로 검증 | Xcode에서 Team 지정 후 Archive, Android release 키는 생성·연결 완료(ADR-024, `build:android:release`) → Play Console 등록·업로드, 각 스토어 등록 |
| B-08 | 실기기 테스트(iPhone/Android 폰) | 5 | 에뮬레이터·시뮬레이터에서 실행·보안 저장소·딥링크·페어링 확인 | 기기에 개발 빌드 설치 후 OS 카메라로 bridge QR 스캔 → 앱 열림·페어링 확인 |
| B-09 | relay 공개 배포(서버·도메인·TLS 인증서) | 6 | 로컬 relay(`pnpm relay`, 127.0.0.1:8787)와 `--relay-only` bridge(들어오는 포트 없음 = NAT 모의)로 웹 → relay → bridge → Claude CLI 실제 스트리밍 검증 | 공개 서버(VPS 등)에 `branch-relay` 실행 + Caddy/nginx로 `wss://relay.<도메인>` TLS 종료, bridge를 `--relay wss://relay.<도메인>`으로 실행 |
| B-10 | GitHub 저장소·Actions secrets 미설정 (로컬 저장소에 remote 없음) | 개선 | 워크플로는 actionlint로 검증, 같은 명령(`pnpm typecheck/lint/test/e2e`, desktop `package`, `build:android`)을 로컬에서 실행해 통과 | GitHub 저장소 생성 후 `git remote add origin … && git push`. 서명 시 Settings › Secrets에 `MAC_CSC_LINK`·`MAC_CSC_KEY_PASSWORD`·`APPLE_ID`·`APPLE_APP_SPECIFIC_PASSWORD`·`APPLE_TEAM_ID`·`WIN_CSC_LINK`·`WIN_CSC_KEY_PASSWORD` 등록, `git tag v0.1.0 && git push --tags`로 릴리스 |
| B-11 | 음성 입력 엔진(whisper-cli) 번들은 macOS arm64만 (Windows·Linux·Intel Mac 미포함), 번들 바이너리 서명·공증(B-03과 함께) | 개선 | 다른 플랫폼과 헤드리스 `rhymebook serve`는 `brew install whisper-cpp`·PATH의 `whisper-cli`, `BRANCH_WHISPER_CLI` 또는 `--whisper-cli`(serve)로 지정. 없으면 설정 › 음성에 설치 안내 | 각 플랫폼 빌드 머신(CI)에서 `apps/desktop/scripts/build-whisper.mjs`에 해당 대상 빌드 추가 후 `vendor/whisper/<플랫폼>`에 넣어 패키징, 서명 시 함께 서명 |
| B-12 | 음성 입력 실기기 확인(iPhone·Android 마이크 권한·녹음) | 개선 | Playwright 가짜 마이크(실제 한국어 WAV를 getUserMedia로 주입)로 웹·패키지 데스크톱 앱에서 녹음 → PC 전사 확인. iOS/Android 권한 키는 추가만 함 | 실기기에서 PC와 페어링 → 설정 › 음성 입력 "준비됨" 확인 → 마이크 버튼 → 권한 허용 → 말한 내용이 입력창에 들어가는지 확인 |
| B-13 | 모바일 앱 발표의 외부 디스플레이(청중 화면만 도구 막대 숨김) | 개선 | 데스크톱·웹은 청중 창으로 해결. 모바일 앱은 OS 화면 미러링으로 발표(도구 막대도 보임), [발표 화면 열기]는 숨김 | iOS UIScene 외부 화면·Android Presentation API용 Capacitor 플러그인 작성 후 실기기 + HDMI/AirPlay로 확인 |
| B-14 | 실기기 확인: 페이지 편집기 선택 시 시스템 메뉴 숨김·키보드 단축키 바 | 개선 | Playwright 모바일(390, 터치)로 단일 선택 메뉴 확인. 네이티브 메뉴 숨김은 실기기만 확인 가능 — 안드로이드는 첫 길게 누르기에서 시스템 메뉴가 한 번 깜빡일 수 있음 | 실기기에서 페이지 글 길게 눌러 고르기 → 앱 선택 메뉴 하나만 뜨는지, 편집 중 키보드 위 단축키 바 확인 |
| B-15 | 작업 에이전트 세션 한도 | 개선 | IMP-30 하위 에이전트 일부가 세션 한도로 끊긴 채 완료라고 보고 → 리더가 직접 이어서 마무리·검증 | 다음 병렬 작업은 에이전트 결과를 diff·테스트로 확인한 뒤에만 반영 |
| B-16 | iOS 앱 종료·장시간 백그라운드 중 응답 완료 알림 (APNs 푸시) | 개선 | 백그라운드 진입 직후 약 30초는 beginBackgroundTask로 이어가고, 그 안에 끝나면 로컬 알림. Android는 포그라운드 서비스로 해결(ADR-106) | Apple Developer 계정에서 APNs 키 발급 → 원격(PC) 모드에서 PC/relay가 완료 시 푸시를 보내는 서버 구성, 실기기에서 확인 |
| B-17 | macOS 앱 안 자동 설치(ADR-118)는 Developer ID 서명·공증된 앱만 가능 | 개선 | 미서명 mac 빌드는 manual 모드: 새 버전 알림 → [다운로드 페이지 열기]. Windows NSIS·Linux AppImage는 서명 없이도 앱 안에서 설치 | B-03과 함께 GitHub Secrets `MAC_CSC_LINK`(p12 base64)·`MAC_CSC_KEY_PASSWORD`·`APPLE_ID`·`APPLE_APP_SPECIFIC_PASSWORD`·`APPLE_TEAM_ID` 등록. 선택: `WIN_CSC_LINK`·`WIN_CSC_KEY_PASSWORD`(SmartScreen 경고 완화) |
| B-18 | 자동 업데이트 대상 발행 | 개선 | CI는 태그마다 초안 Release를 만들고 설치본과 `latest*.yml`·blockmap을 올린다. 초안·prerelease는 앱이 무시 | 버전 올림 → 태그 `vX.Y.Z` 푸시 → Actions 완료 후 Release에 `latest.yml`·`latest-mac.yml`·`latest-linux.yml` 있는지 확인 → **Publish(Latest)** |
| B-19 | 기존 사용자(v0.54.0 이하)는 updater가 없어 한 번 수동 설치 필요 | 개선 | 같은 appId·데이터 폴더(`<appData>/rhymebook`)라 덮어 설치해도 학습 기록·설정 유지 | 첫 자동 업데이트 버전 릴리스 노트에 "이번 한 번은 직접 설치" 안내 |
| B-20 | 실제 설치·재실행 종단 확인 | 개선 | 패키지 앱 e2e(모의 GitHub 응답)로 확인·알림·오류·중복 방지 검증. 실제 다운로드·설치·재실행은 실제 릴리스가 있어야 확인 가능 | 첫 자동 업데이트 버전(N) 설치 → N+1 정식 발행 → Windows·서명 mac에서 알림 → 다운로드 % → 재시작하여 설치 → 새 버전 실행·데이터 유지 확인 |
| B-21 | 지식베이스 OpenAI 의미 검색 실측(ADR-121·124) | 개선 | 키 없이 단위 테스트(dimensions·Retry-After·임베딩 캐시)만 검증. local-hash 대비 OpenAI 품질·지연·비용과 벡터 임계값(VECTOR_ONLY_MIN_COS 0.35·VECTOR_MIN_COS 0.1)은 미측정 | 본인 OpenAI 키로 `EVAL_OPENAI=1 OPENAI_API_KEY=… EVAL_LABEL=openai pnpm --filter @branch/bridge eval:rag` 실행(합성 평가 문서와 이 저장소 코드 일부가 OpenAI로 전송됨) → docs/eval/openai.md를 final-2026-11-06.md와 비교, 임계값 조정 |
| B-22 | 지식베이스 유형 개편 후속 개선(사람 조치 아님) | 개선 | ① 파일 선택기 중복 감지 없음(bridge가 복사 후 반환 — 드롭은 감지함) ② 라이트 모드 실패 배지 대비 4.38:1(앱 공통 danger 색) ③ main의 일부 `t()` 오류는 kb-arg 접두사 없이 일반 오류로 표시 ④ 혼합 라우터는 top-k=1일 때 유형별 1개씩 2개 반환 ⑤ 무결과 질의 근거 부족 판정은 답변 모델에 맡김(평가 n-* 0%) | 다음 개선 작업에서 처리(복사 전 해시 비교 API, danger 토큰 조정, 남은 throw 태깅, 검색 단계 거부 판정) |

예상 항목(발생 시 위 표로 이동): (없음)
