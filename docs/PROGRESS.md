# Project Progress

Last Updated: 2026-10-13
Current Stage: **3단계 — 전체 개발 완료**
Overall Progress: 1·2단계 완료(2026-10-09 컨펌), 3단계 Phase 1~7 전체 완료 + 개선 IMP-01~09 완료 (남은 항목은 사람 조치 — docs/BLOCKERS.md)

> 재개 방법: 루트 `CLAUDE.md` → 이 파일 → `docs/02-ARCHITECTURE.md` → `git log`/`git status` 순으로 읽고,
> 아래 체크리스트에서 첫 번째 미완료 항목부터 이어서 진행한다.
> 게이트 통과: 2026-10-09 사용자 "컨펌". 3단계는 질문 없이 진행(결정 → DECISIONS, 사람 조치 → BLOCKERS).

## 체크리스트

### 1단계 · 설계 문서
- [x] docs/00-VISION.md
- [x] docs/01-PRD.md
- [x] docs/02-ARCHITECTURE.md
- [x] docs/03-PROVIDERS.md
- [x] docs/04-UX-SPEC.md (초안)
- [x] docs/05-ROADMAP.md
- [x] docs/PROGRESS.md / DECISIONS.md / BLOCKERS.md
- [x] 루트 CLAUDE.md

### 2단계 · UI 프로토타입 (Mock 전용)
- [x] S2-01 모노레포 스캐폴드 (pnpm workspace, tsconfig, eslint, vitest, `pnpm dev` host 노출)
- [x] S2-02 core: 모델·트리·앵커 매핑·맥락 구성·Provider 인터페이스·MockProvider·스토어·시드 (+단위 테스트)
- [x] S2-03 ui 셸: 테마 토큰, 프리미티브, AppShell/사이드바, 반응형 훅, 데모 시나리오 메뉴
- [x] S2-04 채팅: 마크다운+코드 하이라이트, 앵커 하이라이트, 선택→가지 생성(데스크톱 메뉴/모바일 액션바), 서브세션 헤더, 요약 카드, 상태 UI
- [x] S2-05 보기: 분할/모바일 탭, 팝업/바텀시트, 마인드맵/전체화면
- [x] S2-06 검색(Cmd+K) + 설정(연결 카드, CLI 상태, 페어링 QR, provider 순서)
- [x] S2-07 통합·독립 리뷰·실제 화면 검증(모바일/데스크톱 스크린샷)
- [x] S2-08 04-UX-SPEC 확정 초안 갱신 + 보고 → 정지(컨펌 대기)
- [x] S2-09 피드백: Vite allowedHosts(*.ts.net) 허용
- [x] S2-10 피드백: 대화 목차·질문 ↑↓ 이동·질문 레일(core `buildTurns` + 테스트) → 재보고

- [x] S2-11 피드백: 설정 › 백업 탭 목업(파일/구글 드라이브/GitHub, 복원 합치기·교체, 자동, 암호) + UX 확정 → **컨펌**

### 3단계 · 전체 개발 (컨펌 후)
- [x] Phase 1 core/ui 실기능화 + Anthropic/OpenAI API Provider
- [x] Phase 2 Dexie 영속화
- [x] Phase 2.5 백업(core BackupTarget, 스냅샷/복원, 파일, 구글 드라이브, GitHub, 자동, 암호화)
- [x] Phase 3 Electron + bridge 내장 + Claude/Codex CLI Provider
- [x] Phase 4 bridge 헤드리스 + 페어링 + RemoteBridgeProvider
- [x] Phase 5 Capacitor 모바일
- [x] Phase 6 relay + E2E 암호화 + fallback
- [x] Phase 7 테스트·E2E·README·패키징

### 개선 (Phase 7 이후, ADR-022)
- [x] IMP-01 CI: GitHub Actions 검증(typecheck/lint/test + e2e), 릴리스(OS별 데스크톱 설치본 + Android APK, secrets 있을 때만 서명) — 실제 실행은 B-10
- [x] IMP-02 모바일 앱 내 QR 스캔(페어링) + 전용 앱 아이콘(데스크톱·iOS·Android·favicon)
- [x] IMP-03 이해 노트: 세션 트리 요약 카드 모아 보기 + Markdown·Anki 내보내기 (+ 모바일 공유 시트 저장)
- [x] IMP-04 CLI 모델·노력치 선택: 설정에서 기본값, 채팅 입력창 칩으로 대화별 변경 (Claude·Codex, ADR-023)
- [x] IMP-05 플랫폼별 연결 UI: PC = CLI·API·원격 페어링 열기(QR)·다른 PC 연결 / 웹·모바일 = PC 페어링·API 키만(모델 선택 없음, PC 정책 적용) + 첫 실행 안내 (ADR-025)
- [x] IMP-07 백그라운드 호스트(트레이)·여러 줄 가지 왼쪽 영역 표시·드래그 메뉴 서식(형광펜·밑줄·글자색·글꼴)·메모 (ADR-028~030)
- [x] IMP-08 드래그 메뉴 비가림 배치·우클릭 모드·색상표(사용자 지정·즐겨찾기)·가지 테마색+아이콘·이 페이지의 가지 목록·원문 접기·세션 우클릭 이름 변경·원격 에이전트/모델/노력치 선택·데모 UI 제거 (ADR-031·032)
- [x] IMP-06 웹·모바일 원격 전용: PC 데스크톱 앱 스토어 동기화(보기·실시간 스트리밍) + 액션 신호로 PC가 CLI 실행 + 원격 전용 UI 개편 (ADR-026, docs/plans/remote-only-plan.md)
- [x] IMP-09 상단 단일/분할 제거(마인드맵 토글만)·사이드바 끌어 좌우·상하 분할(최대 4)·입력창 + 메뉴(사진·파일 첨부, 클립보드 이미지, 긴 붙여넣기 미리보기)·스킬(슬래시·+ 메뉴, 관리 페이지, 예시 커리큘럼 생성) (ADR-033~035)
- [x] IMP-11 AI로 스킬 만들기·고치기: 스킬 편집 칸 위 AI 도우미(요청·빠른 요청 칩·실시간 채움·중지·AI 변경 취소), + 메뉴 [AI로 스킬 만들기…] (ADR-037)

## Tasks

| ID | Epic | Task | Owner | Complexity | Model | Reasoning | Status | Progress | Depends On | Validation |
|---|---|---|---|---|---|---|---|---:|---|---|
| S1-01 | Stage1 | 설계 문서 + CLAUDE.md | lead | MEDIUM | inherit(opus) | default | DONE | 100% | - | PASS: docs/ 9개 파일 + CLAUDE.md 존재 확인 |
| S2-01 | Stage2 | 모노레포 스캐폴드 | lead | LOW | inherit | default | DONE | 100% | S1-01 | PASS: pnpm install, pnpm dev(host 0.0.0.0) 기동 |
| S2-02 | Stage2 | core 도메인/스토어/Mock/시드 | lead | HIGH | inherit | default | DONE | 100% | S2-01 | PASS: core 23 tests, typecheck |
| S2-03 | Stage2 | ui 셸/프리미티브/데모 메뉴 | lead | MEDIUM | inherit | default | DONE | 100% | S2-02 | PASS: typecheck, 375/1440 스크린샷 |
| S2-04 | Stage2 | 채팅·가지·헤더·요약·상태 UI | lead | HIGH | inherit | default | DONE | 100% | S2-03 | PASS: typecheck, 브라우저 조작 + 스크린샷 |
| S2-05 | Stage2 | 분할·팝업·마인드맵 | lead | MEDIUM | inherit | default | DONE | 100% | S2-03 | PASS: typecheck, 브라우저 조작 + 스크린샷 |
| S2-06 | Stage2 | 검색·설정 | lead | MEDIUM | inherit | default | DONE | 100% | S2-03 | PASS: typecheck, 브라우저 조작 + 스크린샷 |
| S2-07 | Stage2 | 통합·리뷰·스크린샷 검증 | lead + 독립 리뷰어(general-purpose) | MEDIUM | inherit | default | DONE | 100% | S2-04,S2-05,S2-06 | PASS: 13개 시나리오 × 375/1440 스크린샷, 콘솔 에러 0 |
| S2-08 | Stage2 | UX-SPEC 갱신·보고 | lead | LOW | inherit | default | DONE | 100% | S2-07 | PASS: 04-UX-SPEC 갱신, 보고 완료 |
| S2-09 | Stage2 | 피드백: Tailscale 호스트 허용 | lead | LOW | inherit | default | DONE | 100% | S2-08 | PASS: rich.*.ts.net 접속 |
| S2-10 | Stage2 | 피드백: 대화 내비게이션(목차/↑↓/레일) | lead | MEDIUM | inherit | default | DONE | 100% | S2-08 | PASS: core 27 tests, typecheck/lint, 375·1440 조작 스크립트(↑↑↓·목차·⌥↓) + 회귀 스크린샷, 콘솔 에러 0 |
| S2-11 | Stage2 | 피드백: 설정 백업 탭 목업 + UX 확정 | lead | MEDIUM | inherit | default | DONE | 100% | S2-08 | PASS: typecheck/lint, 375·1440 백업·복원 조작 스크린샷, 콘솔 에러 0 |
| P1 | Phase1 | 실제 API Provider + 레지스트리 + 리뷰 후속 | lead | HIGH | inherit | default | DONE | 100% | S2-11 | PASS: core 48 tests(SSE·provider·레지스트리·요약 경합·앵커 조각), typecheck/lint, 모의 SSE 서버로 실제 모드 1440·375 조작(키 거부/저장·마스킹, 질문, 가지 3단계, 요약, 분할, 마인드맵), 콘솔 에러 0(의도된 401 제외) |
| P2 | Phase2 | Dexie 영속화(트리·앵커·요약·보기 상태) | lead | MEDIUM | inherit | default | DONE | 100% | P1 | PASS: core 53 tests(persist 복원/보기 보정), ui 6 tests(fake-indexeddb: 시드·새로고침 유지·하위 트리 삭제·재시도 순서·중단 스트림·replaceAll), 실제 모드 1440·375에서 가지 3단계·요약·분할 후 새로고침 → 앵커/요약/패널/시트/트리 동일, 콘솔 에러 0 |
| P2.5 | Phase2.5 | 백업(스냅샷·복원·파일·드라이브·GitHub·자동·암호화) | lead | HIGH | inherit | default | DONE | 100% | P2 | PASS: core 68 tests(스냅샷·암호화·합치기/교체·자동 판단·매니저·GitHub/Drive 대상), ui 9 tests(dexie 대상·replaceAll 보존·암호화 백업→교체 복원), 실제 모드 1440·375: 백업→변경(7→8)→교체 복원(7)·설정 창 유지, 내보내기→가져오기→합치기, 암호화 백업·틀린 암호 거부, 새로고침 유지; 데모 모드 모의 드라이브 연결·백업, 콘솔 에러 0 |
| P3 | Phase3 | Electron + 내장 bridge + Claude/Codex CLI + 상태 감지 | lead | HIGH | inherit | default | DONE | 100% | P2.5 | PASS: core 76 tests(bridge 클라이언트·프롬프트), bridge 15 tests(가짜 CLI: 스트리밍·미설치·미로그인·크래시·중지·타임아웃·동시성) + 실제 CLI 3 tests(BRANCH_REAL_CLI=1), Electron E2E(playwright _electron): 실제 claude-cli 스트리밍 응답 1.9s, 상태 "Claude Code 2.1.283 · 로그인됨", 미설치 → 설치 안내, 미로그인 → `claude auth login`/`codex login` 안내, safeStorage 암호문 저장·재시작 복원, 콘솔 에러 0 |
| P4 | Phase4 | 헤드리스 bridge + 페어링(QR/코드·기기 키·E2E 암호화) + RemoteBridgeProvider | lead | HIGH | inherit | default | DONE | 100% | P3 | PASS: bridge 12 remote tests(QR/코드 페어링·1회용·5회 오답 취소·만료·키 불일치 차단·unreachable·상태/스트리밍·해제 시 끊김·offline·메시지 검증), 실제 개발 서버(390px)에서 헤드리스 bridge 링크 페어링 → 지문 표시·"LAN 직접 연결" → claude-cli 원격 경유 실제 스트리밍 응답 ~2s, 콘솔 에러 0 |
| P5 | Phase5 | apps/mobile Capacitor 8(iOS SPM/Android) + 보안 저장소(Keychain/Keystore) + `branch://pair` 딥링크 + safe-area | lead | HIGH | inherit | default | DONE | 100% | P4 | PASS: Android `assembleDebug` → 에뮬레이터(Pixel 2, Android 16) 실행·Keystore 저장/삭제·딥링크 폼 입력·ws 원격 bridge 페어링(지문 일치)·재시작 후 유지. iOS 시뮬레이터 빌드 성공(Xcode 26.1, iPhone 17 Pro iOS 26.1) → 실행·safe-area 수정 확인·`branch://` 스킴 OS 라우팅 확인 |
| P6 | Phase6 | packages/relay(다중화 중계·자기 증명 등록) + bridge relay 커넥터·`--relay`/`--relay-only` + 직접→relay 대체·4404 안내 + offline fallback | lead | HIGH | inherit | default | DONE | 100% | P5 | PASS: core 91 tests(relay 주소·링크 `r`·등록 서명·프레임), relay 9 tests(NAT 모의 bridge: 링크/코드 페어링·스트리밍·직접 실패→relay·relay가 토큰/평문 미노출·4404·offline·위조 등록 거부·404·health), 실제 프로세스: relay CLI + `--relay-only` bridge(리슨 포트 없음) → 개발 서버(390px) 링크 페어링 "Relay 경유" → claude-cli 실제 스트리밍 ~2s |
| P7 | Phase7 | 앵커 복원·맥락 구성 단위 테스트 + Playwright E2E(모의 SSE) + README + electron-builder 패키징 + CLI `--` 인자 수정 | lead | MEDIUM | inherit | default | DONE | 100% | P6 | PASS: core 106 tests(+15), E2E 7 passed·1 skipped(데스크톱 전용 항목의 모바일 건너뜀), `package:dir` 미서명 macOS arm64 앱 생성·실행 8s 확인 |
| IMP06-T0 | IMP-06 | 계획·ADR-026·sync 계약 + critic 리뷰 반영 | lead | HIGH | inherit | default | DONE | 100% | - | docs/plans/remote-only-plan.md, critic 리뷰 8건 반영 |
| IMP06-T1 | IMP-06 | core: store 선택적 id·sync host/client·검증기·테스트 | agent-core→lead | HIGH | inherit | default | DONE | 100% | T0 | PASS: core 148 tests(sync 20: 실제 데모 provider 호스트↔클라이언트 왕복 + 오프라인 중 삭제된 활성 가지 → 부모로 포커스), 독립 리뷰 지적(pruneView 세션 인자 누락) 수정·회귀 테스트. 테스트 간 지연 메시지 누수(flaky) 수정: 넷을 테스트별 호스트에 고정 → 10회 연속 통과 |
| IMP06-T2 | IMP-06 | bridge 서버 sync 라우팅 / desktop IPC 중계·엔진 준비·창 숨김 | agent-host→lead(테스트) | HIGH | inherit | default | DONE | 100% | T0 | PASS: bridge 38 passed/3 skipped(실제 ws 2기기 동기화·peerGone·invalid act), 독립 리뷰 GOOD |
| IMP06-T3 | IMP-06 | UI 원격 전용 개편(스토어·온보딩·설정·상태칩·오프라인) + 호스트 엔진 연결 | agent-ui→lead | HIGH | inherit | default | DONE | 100% | T1,T2 | PASS: typecheck·lint, 390/768/1440 스크린샷(온보딩·페어링 폼·답변·설정·사이드바), PC 토스트. smoke에서 발견한 '자동' 에이전트 미선택(API 키 오류) 수정: 준비된 CLI(Claude 우선) 선택 |
| IMP06-T4 | IMP-06 | E2E: 로컬 흐름 `?platform=desktop`, 원격 모드 E2E | lead | MEDIUM | inherit | default | DONE | 100% | T3 | PASS: e2e 12 passed·2 skipped(웹 원격 전용 온보딩·설정·입력 차단, 로컬 흐름, 확인 대화상자) |
| IMP06-T5 | IMP-06 | 독립 리뷰·스크린샷·데스크톱 빌드·실제 페어링 smoke | lead+reviewer | HIGH | inherit | default | DONE | 100% | T1–T4 | PASS: 독립 리뷰어 지적 2건(1 수정, 1 방어적·무변경). `package:dir` 재빌드 → 격리 실행 앱에서 원격 페어링 열기 → 웹(390)에서 Tailscale ws://100.102.77.120:7777 + 코드 페어링 → PC '페어링 기기 2대(접속 1)' → 웹에서 새 학습·질문 → PC 토스트 '원격 기기: 질문을 보냈어요' → PC claude-cli exit=0 답변·자동 제목 '광합성의 정의'가 웹 390/768/1440·PC 사이드바에 반영 |
| IMP06-T6 | IMP-06 | 문서·커밋 | lead | LOW | inherit | default | DONE | 100% | T5 | PASS: 01/02/03/04/README·ADR-026·PROGRESS 갱신, typecheck·lint·test·e2e 통과 후 커밋 |
| IMP07-T0 | IMP-07 | 계획·ADR-028/029/030·모델 계약 | lead | HIGH | inherit | default | DONE | 100% | - | docs/plans/imp07-plan.md, model.ts Annotation 계약 |
| IMP07-T1 | IMP-07 | core: annotation 스토어·repo·백업·sync + ui persist(Dexie v3) | agent-core | HIGH | inherit | default | DONE | 100% | T0 | PASS: core 210 tests(annotation CRUD·연쇄 삭제·백업 호환·sync 검증·왕복·오프라인/거부 롤백) |
| IMP07-T2 | IMP-07 | UI: 서식·메모 렌더, 영역 막대, 드래그 메뉴 서식·메모, 팝오버 | agent-ui | HIGH | inherit | default | DONE | 100% | T0 | PASS: ui 12 tests(rehypeAnchors 영역 조각) |
| IMP07-T3 | IMP-07 | desktop: 트레이·백그라운드 실행·완전 종료 | agent-desktop | MEDIUM | inherit | default | DONE | 100% | T0 | PASS: typecheck·빌드, 트레이 아이콘 asar 포함 |
| IMP07-T4 | IMP-07 | 통합·E2E·독립 리뷰 | lead+reviewer | HIGH | inherit | default | DONE | 100% | T1–T3 | PASS: e2e 18 passed·2 skipped(annotations 3×2). 리뷰 지적: annotation op 롤백 없음 → 수정, 서식 버튼 후 오래된 메뉴 → 수정, 나머지 기존 패턴 유지 |
| IMP07-T5 | IMP-07 | 스크린샷·데스크톱 빌드·백그라운드 smoke | lead | MEDIUM | inherit | default | DONE | 90% | T4 | PASS: 390/768/1440 스크린샷(서식·메모·영역 막대·팝오버·모바일 바텀 바), `package:dir` 재빌드·실행. 트레이 수동 smoke(호스트 켬→창 닫기→웹 계속→완전 종료)는 사용자 확인 필요 |
| IMP07-T6 | IMP-07 | 문서·커밋 | lead | LOW | inherit | default | DONE | 100% | T5 | PASS: 01/02/04/README·ADR-028~030·PROGRESS 갱신 후 커밋 |
| IMP08-T1 | IMP-08 | core: MarkColor #rrggbb·isMarkColor, sync op `session.agent`(호스트·클라이언트), Mock을 플랫폼 provider 목록에서 제외 | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: core 214 passed(+색 검증·session.agent 왕복/검증). 기존 실패 1건(sync.reset, Windows) 변경 전 코드에서도 동일 |
| IMP08-T2 | IMP-08 | UI: placeMenu·우클릭 모드 설정·색상표(즐겨찾기·추천·사용자 지정)·가지 테마색+끝 아이콘·가지 목록 플로팅·원문 접기 토글·RemoteAgentPicker·세션 우클릭 이름 변경·데모 바/카드 제거 | lead | HIGH | inherit | default | DONE | 100% | T1 | PASS: typecheck·lint, ui 20 tests(placeMenu 6·가지 끝·사용자 지정 색), 1440/390 스크린샷 |
| IMP08-T3 | IMP-08 | E2E·데스크톱 빌드·문서 | lead | MEDIUM | inherit | default | DONE | 100% | T2 | PASS: e2e 26 passed·4 skipped(색상표·즐겨찾기·비가림·우클릭 모드·가지 목록·원문 접기·이름 변경). Windows `package:dir` 빌드·실행. bridge 19·relay 2 실패는 변경 전 코드에서도 동일(Windows 가짜 CLI 실행 환경) |
| IMP09-T1 | IMP-09 | core: SplitNode 배치 트리(splitLayout.ts)·fixSplit·dropToSplit·closeMindmap, Attachment·Skill 모델·검증, toTurns 텍스트 첨부·마지막 질문 스킬, Anthropic/OpenAI content 블록, sync send 첨부·스킬, MAX_SPLIT 4 | lead | HIGH | inherit | default | DONE | 100% | - | PASS: core 235/237(+22: splitLayout 8·첨부/스킬 11·store 드롭/마인드맵/첨부 3). 실패 2건(store 자동 제목, sync.reset)은 변경 전 코드에서도 동일(Windows) |
| IMP09-T2 | IMP-09 | bridge: claude `--input-format stream-json` 첨부 블록, codex `--image` 임시 파일, 원격 chat.start 첨부 검증, WebSocket 프레임 16MB(bridge·relay) | lead | MEDIUM | inherit | default | DONE | 100% | T1 | PASS: bridge 단위 2건 추가, 실제 CLI(claude 2.1.296·codex 0.154.0)에 빨간 PNG → 둘 다 "빨강". bridge 19·relay 2 실패는 변경 전과 동일 |
| IMP09-T3 | IMP-09 | UI: 상단 마인드맵 토글, 재귀 SplitView(좌우·상하 Group)·DropZone·사이드바 행 끌기·우클릭 분할 열기, Composer + 메뉴·첨부 미리보기·붙여넣기·슬래시 스킬, 보낸 질문 첨부·스킬 배지, 스킬 관리 페이지·Dexie v4 skills | lead | HIGH | inherit | default | DONE | 100% | T1 | PASS: typecheck·lint, ui 20 tests, 1440·390 스크린샷 |
| IMP09-T4 | IMP-09 | E2E·데스크톱 빌드·문서 | lead | MEDIUM | inherit | default | DONE | 100% | T3 | PASS: e2e 31 passed·5 skipped(+끌어 분할·첨부·스킬 3×2, 보기 테스트 갱신). Windows `package:dir` → 격리 userData 앱에서 Claude CLI 이미지 질문 "빨간색"(31s)·스킬 칩, 콘솔 에러 0 |

## Active Work
- 없음 (IMP-11 완료. 트레이 백그라운드 수동 확인과 사람 조치 — docs/BLOCKERS.md)
- 확인 필요: Windows에서 core `sync.reset`·`자동 제목` 2건, bridge 19건, relay 2건 테스트가 IMP-08 이전 코드에서도 실패(macOS 기준 통과 기록). 원인 미조사

## Blockers
- 없음 (docs/BLOCKERS.md 참조)

## Decisions
- docs/DECISIONS.md 참조

## Latest Integration Result
- 2026-10-13 · 개선(IMP-11, Windows): `pnpm typecheck`·`pnpm lint` PASS, core 245/247(+10 skill-assist, 실패 2는 기존과 동일)·ui 20/20, e2e `skill-assist`·`composer-split` desktop·mobile PASS. Windows `package:dir` 빌드·실행.
- 2026-10-13 · 개선(IMP-09, Windows): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` core 235/237·ui 20/20 PASS(실패 2·bridge 19·relay 2는 변경 전과 동일), `pnpm e2e` 31 passed · 5 skipped. Windows `package:dir` 빌드·실행, 실제 Claude CLI 이미지 첨부 응답 확인. 커밋 `improve: …`.
- 2026-10-12 · 개선(IMP-08, Windows): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` core 214/215·ui 20/20 PASS, bridge 19·relay 2·core 1 실패는 변경 전 코드와 동일(기존). `pnpm e2e` 26 passed · 4 skipped. Windows `package:dir` 빌드·실행 확인. 커밋 `improve: …`.
- 2026-10-12 · 개선(IMP-05): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 128, bridge 31+3 skipped, ui 9, relay 9), `pnpm e2e` 11 passed · 1 skipped. 데스크톱 `package:dir` 빌드·실행 확인. 커밋 `improve: …`.
- 2026-10-12 · 개선(IMP-04): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 118, bridge 30+3 skipped, ui 9, relay 9), `pnpm e2e` 9 passed · 1 skipped. 실제 CLI(claude haiku/low, codex gpt-6-luna/low) bridge 경유 응답 확인. 커밋 `improve: …`.
- 2026-10-10 · 개선(IMP-01~03): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 111, bridge 27+3 skipped, ui 9, relay 9), `pnpm e2e` 9 passed · 1 skipped. actionlint PASS. Android debug APK·iOS 시뮬레이터 빌드 성공. 커밋 `improve: …`.
- 2026-10-10 · Phase 7: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 106, bridge 27+3 skipped, ui 9, relay 9), `pnpm e2e` 7 passed · 1 skipped(1440·390). electron-builder `--dir` 미서명 패키지 실행 확인. 커밋 `phase-7: …`.
- 2026-10-10 · Phase 6: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 91, bridge 27+3 skipped, ui 9, relay 9). NAT 모의(relay 전용 bridge) 웹 → relay → Claude CLI 실제 스트리밍. 커밋 `phase-6: …`.
- 2026-10-10 · Phase 5: `pnpm typecheck` PASS(apps/mobile 포함), `pnpm lint` PASS, `pnpm test` PASS(core 86, bridge 27+3 skipped, ui 9). Android 에뮬레이터·iOS 시뮬레이터 빌드/실행 검증. 커밋 `phase-5: …`.
- 2026-10-10 · Phase 4: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 86, bridge 27+3 skipped, ui 9). 웹 → 원격 bridge → Claude CLI 실제 스트리밍 E2E. 커밋 `phase-4: …`.
- 2026-10-10 · Phase 3: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 76, bridge 15+3 skipped, ui 9). Electron 실제 CLI 스트리밍·미설치/미로그인 안내 E2E. 커밋 `phase-3: …`.
- 2026-10-09 · Phase 2.5: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 68, ui 9). 실제·데모 모드 백업/복원 브라우저 검증(1440/375). 커밋 `phase-2.5: …`.
- 2026-10-09 · Phase 2: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 53, ui 6). 실제 모드 새로고침 유지 검증(1440/375). 커밋 `phase-2: …`.
- 2026-10-09 · Phase 1: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 48). 로컬 모의 Anthropic SSE 서버(`VITE_ANTHROPIC_BASE_URL`)로 실제 모드 E2E 조작 검증(1440/375). 커밋 `phase-1: …`.
- 2026-10-09 · 2단계: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(core 23).
  13개 데모 시나리오를 375px/1440px로 스크린샷 검증(콘솔 에러 0). 커밋 `stage-2: 모바일/웹 UI 프로토타입`.

## Known Issues
- relay 실행: `pnpm relay` (기본 :8787) + `pnpm bridge -- --pair --relay ws://<relay>:8787 [--relay-only]`. 공개 배포는 TLS 프록시 뒤 wss(B-09).
- 모바일 실행: `pnpm --filter @branch/mobile build:android` / `build:ios-sim` (Android Studio·Xcode 필요, iOS는 Xcode › Settings › Components에서 iOS 플랫폼 설치). 앱 내 [QR 스캔](카메라 권한) 또는 OS 카메라 → `branch://pair` 딥링크로 페어링. Android minSdk 26.
- 모바일 상단 바에서 긴 세션 제목은 말줄임 처리됨(의도된 동작).
- E2E: `pnpm e2e` (최초 `pnpm exec playwright install chromium`). 데스크톱 패키징: `pnpm --filter @branch/desktop package` (미서명, B-03).
- (해결, Phase 1) 겹치는 앵커 위치 판정, indexOf 폴백 오매칭, 요약 초안 경합·에러 시 부분 텍스트 유실 → ADR-012/013.
- 데스크톱 실행: `pnpm --filter @branch/desktop build && pnpm --filter @branch/desktop start` (개발: Vite 서버 기동 후 `pnpm --filter @branch/desktop dev`).
- 웹 API 키는 탭 메모리 전용이라 새로고침 시 다시 입력해야 함(의도, 설정 경고 표시). 실제 키 검증은 B-02.
