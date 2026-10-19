# Project Progress

Last Updated: 2026-10-16
Current Stage: **3단계 — 전체 개발 완료**
Overall Progress: 1·2단계 완료(2026-10-09 컨펌), 3단계 Phase 1~7 전체 완료 + 개선 IMP-01~09 완료 (남은 항목은 사람 조치 — docs/BLOCKERS.md)

> 재개 방법: 루트 `CLAUDE.md` → 이 파일 → `docs/02-ARCHITECTURE.md` → `git log`/`git status` 순으로 읽고,
> 아래 체크리스트에서 첫 번째 미완료 항목부터 이어서 진행한다.
> 게이트 통과: 2026-10-09 사용자 "컨펌". 3단계는 질문 없이 진행(결정 → DECISIONS, 사람 조치 → BLOCKERS).

## OctoBooks 정식판 v0.20.0 — main 머지 (2026-10-16)

- DONE: preview/octobooks를 main에 머지. 앱 ID·데스크톱 데이터 폴더·키체인 이름은 기존 값 유지, 표시 이름 OctoBooks, 정식 태그 릴리즈 워크플로 복원 (ADR-062).

## OctoBooks beta 3 — completed (2026-10-16)

- DONE: approved graduation-cap/pencil icon applied across platform assets; smaller sidebar icon + OctoBooks wordmark.
- DONE: stronger light/dark palette contrast and bluer Ocean; independent review passed.
- DONE: typecheck/lint, 532 unit/integration tests, 79 E2E, final mobile6, macOS package and isolated packaged smoke.
- DONE: iOS simulator build with preview identity/build23.
- DONE: source8ab5be3 committed/tagged as v0.20.0-beta.3, exact-source CI and all platform release builds passed, seven assets published as prerelease (not Latest). Downloaded macOS distribution smoke and APK metadata/hash verification passed. Stable main and Latest unchanged. Plan: docs/rebrand/BETA3_PLAN.md; evidence: docs/rebrand/VALIDATION.md.

## octobooks preview rebrand — completed 2026-10-16

Plan: `docs/rebrand/MASTER_PLAN.md`; design: `docs/rebrand/DESIGN.md`; architecture reused from `docs/02-ARCHITECTURE.md`; validation: `docs/rebrand/TEST_STRATEGY.md`.
Overall: 8/8 tasks DONE (100%); all work isolated in preview/octobooks.

| ID | Epic | Task | Owner | Complexity | Model | Reasoning | Status | Progress | Depends On | Validation |
|---|---|---|---|---|---|---|---|---:|---|---|
| OCT-ARCH | Rebrand | Contracts and independent plan review | lead + architecture reviewer | HIGH | inherited | high | DONE | 100% | - | PASS: separate worktree; independent review, explicit preview userData and prerelease flags incorporated |
| OCT-THEME | Rebrand | Device-local palettes and settings | executor | MEDIUM | gpt-5.5 | medium | DONE | 100% | OCT-ARCH | PASS: UI55 tests; appearance E2E8; five palettes in both modes; storage fallback and multiwindow sync |
| OCT-BRAND | Rebrand | Identity, shell, illustrations, platform icons | executor | MEDIUM | gpt-5.5 | medium | DONE | 100% | OCT-ARCH | PASS: original SVG/icons/splash; desktop/mobile/tablet screenshots independently reviewed |
| OCT-RELEASE | Rebrand | Preview identities and beta release pipeline | lead | HIGH | inherited | inherited | DONE | 100% | OCT-ARCH | PASS: independent adversarial review; preview native identities/userData/sessionData and prerelease-only workflow |
| OCT-INTEGRATE | Rebrand | Tests, builds and real Electron/web UI smoke | lead | HIGH | inherited | inherited | DONE | 100% | OCT-THEME,OCT-BRAND,OCT-RELEASE | PASS: local and CI typecheck/lint/build; 532 tests; final E2E79; actual distribution Electron smoke; iOS simulator build; no main changes |
| OCT-REVIEW | Rebrand | Independent final review | code-reviewer | CRITICAL | gpt-5.5 | high | DONE | 100% | OCT-INTEGRATE | PASS: independent adversarial + visual reviews, no blocking findings; bootstrap fallback fixed and validated |
| OCT-PUBLISH | Rebrand | GitHub preview prerelease and CI artifacts | lead | HIGH | inherited | inherited | DONE | 100% | OCT-REVIEW | PASS: v0.20.0-beta.1 published, prerelease=true/latest=false; 7 assets; release CI38865307519 successful |
| OCT-DOCS | Rebrand | Evidence/docs sync and isolation proof | lead | LOW | inherited | inherited | DONE | 100% | OCT-PUBLISH | PASS: README + docs/rebrand/VALIDATION.md updated; local/remote main e0a9a62 unchanged and original checkout clean |

Decisions: no dependency/schema changes; UI-only color palette; independent preview app identities/data; preserve compatibility protocol/storage markers. Main baseline e0a9a6259685cb03c949477be606bbe3ccce0430. Existing GitHub access confirmed via gh with network permission. OMX fixed legacy models unavailable for account (explore/architect/critic); leader performs implementation directly and Compound installed architecture/review roles provide independent review with supported inherited model.

후속 UI 조정(2026-10-16): 좌측 상단 아이콘 외 브랜드 문구 제거, 최상단 바 아이콘·중복 제목·PREVIEW 제거. UI 타입/린트·데스크톱/모바일 스크린샷·핵심 E2E9 통과, Preview 앱 재빌드. 별도 preview 브랜치에서만 적용.

베타2 릴리즈(2026-10-16): DONE — 상단 디자인 후속 수정 b4fbafe를 포함해 v0.20.0-beta.2로 배포. Android/iOS 빌드 번호22. 베타2 설치 파일7개 게시, CI532/79 통과, 실제 mac 배포 앱·Android22 검증 완료. 기존 베타1·main·안정판 Latest 유지. 미추적 icon-candidates 작업물은 배포 커밋에 포함하지 않음.

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
- [x] IMP-10 사이드바 우클릭 가지 삭제·새 창으로 열기(데스크톱 세션 창, 중복 허용)·수식($$·$·\[\]·\(\) KaTeX)·분할창 [자리 이동] 메뉴·경계선 ⋯ [자리 바꾸기·방향 전환] (ADR-036, docs/plans/imp-10-plan.md)
- [x] IMP-11 AI로 스킬 만들기·고치기: 스킬 편집 칸 위 AI 도우미(요청·빠른 요청 칩·실시간 채움·중지·AI 변경 취소), + 메뉴 [AI로 스킬 만들기…] (ADR-037)
- [x] IMP-12 스킬 고도화: 부수 파일(references/·scripts/·assets/) 보기·추가·가져오기·편집, 데스크톱 스킬 폴더(`<userData>/skills/<name>/SKILL.md`) 열기·폴더 변경 반영·Claude 형식 폴더 가져오기, AI 작성 시 부수 파일 생성·수정·삭제, 고급 옵션(스킬 전용 provider·모델·노력치, 미설정 시 세션 설정) (ADR-038, docs/plans/imp-12-plan.md)
- [x] IMP-14 `rhymebook serve` 헤드리스 호스트: Electron 없이 서버만 켜고 웹·모바일이 페어링해 사용 (ADR-040, docs/plans/headless-serve-plan.md)
- [x] IMP-15 Codex 이미지 생성: 일반 대화에서 image_generation 켜기, 생성 이미지를 답변 첨부로 표시·동기화·저장 (ADR-041)
- [x] IMP-16 음성으로 질문하기: PC 로컬 whisper.cpp 전사(설정 › 음성에서 켜기·모델 받기), 입력창 마이크, 웹·모바일은 PC 설정을 따름 (ADR-045, docs/plans/voice-input-plan.md)
- [x] IMP-16b 웹·모바일에서 PC 음성 설정 관리: 켜기·모델 선택·받기(진행률·취소)·지우기 (ADR-046)
- [x] IMP-16c 헤드리스 `rhymebook serve`도 음성 입력(whisper-cli), 원격 기기에서 설정 관리 (ADR-047)
- [x] IMP-17 퀴즈: 기본 스킬 `/quiz`(OX·객관식·주관식), 답변 속 ```quiz 블록을 대화창 카드로 한 문제씩 풀이·정오·정답·해설·점수 (ADR-048)
- [x] IMP-18 선택 메뉴 [복사] 버튼, 모바일 앱은 본문 선택 시 시스템 텍스트 메뉴 숨김(입력창은 유지) (ADR-049)
- [x] IMP-19 발음 듣기: 선택 메뉴 [듣기], 기기 음성 기본, OpenAI 음성 하나 선택·실패(키·한도·연결) 시 기기 음성으로 대체, 설정 › 음성 「읽어 주기」 (ADR-050)
- [x] IMP-20 모바일 앱 발음 듣기: iOS·Android 앱은 네이티브 기기 음성(TTS 플러그인), 음성 실패 시 같은 언어 다른 음성으로, 언어 미설치 안내, iOS 무음 스위치 무시 (ADR-051)
- [x] IMP-21 음성으로 읽기: 기본 스킬 `/speak`, 답변 속 ```speak 블록을 읽기 카드로(줄마다 듣기·모두 듣기), 요청에 맞는 스킬 자동 사용(입력창 자동 칩·빼기·설정에서 끄기) (ADR-052, docs/plans/speak-skill-plan.md)
- [x] IMP-22 직접 만든 하위 세션(각주): 사이드바 모든 세션 [+] → 질문 입력으로 하위 세션, 부모 대화 끝 각주 목록·내비게이션 하단 고정 (ADR-054, docs/plans/free-branch-vault-navhandle-plan.md)
- [x] IMP-23 보관함: 답변 글·선택 글·이미지·읽기 카드(음성) 보관, 폴더 트리(만들기·이름·옮기기·지우기), 조각을 엮는 페이지(보기/편집·Markdown 저장), 저장·백업·원격 동기화 (ADR-055)
- [x] IMP-24 모바일 세션 내비게이션 핸들: 끌어 좌/우 가장자리에 붙이기(가운데 놓으면 애니메이션 스냅), 핸들 탭 → 숨기기, 세션 상단 provider 오른쪽 아이콘으로 다시 표시 (ADR-056)
- [x] FIX-25 모바일 [보관함에 담기]·[+] 하위 세션 "요청을 처리할 수 없어요" — 원인: 옛 serve 번들. 보관함이 로컬·서버 파일에 저장되지 않던 버그 수정, 호스트 기능 목록·'outdated' 안내 (ADR-057)
- [x] IMP-26 보관함 UI/UX 개편: 태블릿 이상 높이 80%·전체 화면 전환, 트리 끌어서 옮기기·[이동] 폴더 선택 창, 상세 상단 도구 모음, 페이지 [저장](미저장 확인), 블록 손잡이 끌기·좌우 나란히 배치 (ADR-058)
- [x] IMP-27 보관함 트리 끌기: 놓을 자리 선 표시, 같은 폴더 안 순서 바꾸기(`order`·`placeVaultNode`) (ADR-059)
- [x] IMP-28 사이드바 경계 끌어 너비 조절(기기별 저장), 분할창 이동 버튼 끌어 옮기기, 드래그 메뉴 글자 잘림 수정, [질문에 첨부] (ADR-060)
- [x] IMP-29 드래그 메뉴에서 선택한 글 직접 고치기 → 질문·첨부·복사·듣기·보관에 사용, 앵커는 원래 선택 (ADR-061)

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
| IMP10-T1 | IMP-10 | 가지 우클릭 삭제(하위 포함 확인) | lead | LOW | inherit | default | DONE | 100% | - | PASS: 패키지 앱에서 가지 우클릭 → 삭제 → 확인 → 행 제거 |
| IMP10-T2 | IMP-10 | 세션 별도 창: preload `windows`·main 세션 창/`win-*` 피어 중계·스로틀링, ui 세션 창 셸·로컬 SyncClient, host `allowDelete(peerId)` | lead | HIGH | inherit | default | DONE | 100% | - | PASS: 패키지 앱(격리 userData)에서 같은 가지 새 창 2개(창 3개), 세션 창 렌더·메인에서 이름 변경 → 세션 창 제목 실시간 반영 |
| IMP10-T3 | IMP-10 | 수식 KaTeX + 앵커 맵·선택 offset 처리 | agent-math | MEDIUM | inherit | default | DONE | 100% | - | PASS: ui 36 tests(+17 math), 패키지 앱에서 인라인·블록 수식 + 수식 옆 가지 앵커 표시 |
| IMP10-T4 | IMP-10 | core 분할 이동·스왑·방향 전환 + SplitControls | agent-split | MEDIUM | inherit | default | DONE | 100% | - | PASS: core splitLayout·store 테스트(+6), 패키지 앱에서 자리 이동(오른쪽과) → 순서 [b1, root1], ⋯ → 방향 전환 → 상하 분할 |
| IMP10-T5 | IMP-10 | 통합·E2E·빌드·문서 | lead | MEDIUM | inherit | default | DONE | 100% | T1–T4 | PASS: 아래 Latest Integration Result |
| IMP12-T1 | IMP-12 | core: Skill files·options, 파일 경로·검증·`withSkill` 파일 첨부, `chatTarget`(스킬 턴만 전용 provider), host 원격 옵션 제한, `skillFolder`(SKILL.md 직렬화·가져오기·diff·frontmatter 유지), AI 도우미 `<file>`/`<delete>` | lead | HIGH | inherit | default | DONE | 100% | - | PASS: core skill-files·skill-assist·attachments-skills 43/43 |
| IMP12-T2 | IMP-12 | desktop: 스킬 폴더 IPC `skillsDir.ts`(경로 검증·이름 변경 이동·지운 파일만 삭제·직렬 큐) | agent-desktop | MEDIUM | inherit | default | DONE | 100% | T1 계약 | PASS: 임시 폴더 왕복·경로 거부·이동·frontmatter 유지 스크립트 |
| IMP12-T3 | IMP-12 | ui: 스킬 파일 편집·폴더 열기·고급 옵션, 폴더 거울·포커스 동기화·묘비, 칩 표시 | lead | HIGH | inherit | default | DONE | 100% | T1·T2 | PASS: e2e skill-assist 4/4 |
| IMP12-T4 | IMP-12 | 독립 리뷰·수정·패키지 앱 스모크·문서 | reviewer+lead | MEDIUM | inherit | default | DONE | 100% | T3 | PASS: 리뷰 지적 8건 반영, 아래 Latest Integration Result |
| IMP14-T1 | IMP-14 | skillsDir를 `@branch/bridge`로 이동, server fileRepo + 테스트 | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: fileRepo 3 테스트, 데스크톱 typecheck·package:dir |
| IMP14-T2 | IMP-14 | server engine(헤드리스 조립)·CLI·빌드·통합 테스트(가짜 CLI·실제 ws 페어링) | lead | HIGH | inherit | default | DONE | 100% | T1 | PASS: serve 통합 4 테스트(페어링→질문→답변→재시작 유지·삭제 막기·API 키 비저장), `dist/rhymebook.cjs` |
| IMP14-T3 | IMP-14 | 독립 리뷰·반영 | reviewer+lead | MEDIUM | inherit | default | DONE | 100% | T2 | PASS: HIGH 0, MEDIUM 2·LOW 1 반영(첫 실행 즉시 저장, 스킬 경로 확인·실패 로그) |
| IMP14-T4 | IMP-14 | 빌드 산출물 실제 스모크(serve + 원격 웹 페어링·질문)·README·문서 | lead | MEDIUM | inherit | default | DONE | 100% | T3 | PASS: 아래 Latest Integration Result |
| IMP16-T1 | IMP-16 | core: `stt.ts`(모델 카탈로그·WAV 인코딩·리샘플·무음 판정·결과 정리), 프로토콜 `stt.status.get`·`stt.transcribe`, BridgeClient·원격 검증 | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: core stt 9 tests + 프로토콜 검증 |
| IMP16-T2 | IMP-16 | bridge: SttEngine(설정·다운로드 sha256·취소·지우기·whisper-cli 직렬 실행), server·원격 호스트 처리 | lead | HIGH | inherit | default | DONE | 100% | T1 | PASS: bridge stt-engine(가짜 whisper·가짜 fetch) |
| IMP16-T3 | IMP-16 | desktop: whisper-cli 정적 Metal 빌드 스크립트·extraResources, IPC/preload/main/host, 마이크 권한 | lead | MEDIUM | inherit | default | DONE | 100% | T2 | PASS: 패키지 앱에 `Resources/whisper/whisper-cli` 포함, 번들 바이너리로 실제 전사 |
| IMP16-T4 | IMP-16 | ui: 설정 음성 탭·원격 상태, Composer 마이크·녹음·무음 차단, 모바일 권한(iOS·Android) | lead | MEDIUM | inherit | default | DONE | 100% | T1,T3 | PASS: e2e 원격 음성 상태 2/2, 패키지 앱 스크린샷 |
| IMP16-T5 | IMP-16 | 독립 리뷰·반영·검증·패키지 앱 스모크·문서 | lead | MEDIUM | inherit | default | DONE | 100% | T4 | PASS: 아래 Latest Integration Result |
| IMP16-T6 | IMP-16 | 원격 음성 설정 관리(`stt.state.get`·`stt.manage`, 원격 설정 화면, 받기 취소 스트림 오류 수정) | lead | MEDIUM | inherit | default | DONE | 100% | T5 | PASS: 아래 Latest Integration Result |
| IMP16-T7 | IMP-16 | 헤드리스 server STT 엔진 연결(`<dir>/stt`, `--whisper-cli`, 시작 상태 줄, 종료 시 받기 취소), 미지원 bridge 안내 문구 | lead | MEDIUM | inherit | default | DONE | 100% | T6 | PASS: 아래 Latest Integration Result |
| IMP17-T1 | IMP-17 | core: `quiz.ts`(parseQuiz·gradeQuiz·정답 표시), 기본 스킬 `/quiz`(기존 사용자 시드), mock 퀴즈 답변 | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: core quiz 테스트 + 스킬 시드·sync 기대값 갱신 |
| IMP17-T2 | IMP-17 | ui: `QuizCard.tsx`(카드·한 문제씩·정오/정답/해설·점수·다시 풀기·풀이 기억), Markdown `pre` 분기·생성 중 표시, 원본 숨김으로 앵커 오프셋 유지 | lead | MEDIUM | inherit | default | DONE | 100% | T1 | PASS: e2e quiz 2/2(desktop·mobile) |
| IMP17-T3 | IMP-17 | 독립 리뷰·반영·검증·패키지 앱·문서 | reviewer+lead | MEDIUM | inherit | default | DONE | 100% | T2 | PASS: 아래 Latest Integration Result |
| IMP18-T1 | IMP-18 | ui: SelectionMenu [복사](clipboard·execCommand 대체·"복사됨"), 모바일 4칸·데스크톱 440px, e2e | lead | LOW | inherit | default | DONE | 100% | - | PASS: e2e 복사 2/2(desktop·mobile) |
| IMP18-T2 | IMP-18 | mobile: iOS `TextMenu.swift`(AppWebView·AppViewController·플러그인), Android `AppWebView`·`TextMenuPlugin`·레이아웃, JS 가드(입력창 예외) | lead | MEDIUM | inherit | default | DONE | 100% | T1 | PASS: Android 에뮬레이터 실측, iOS 빌드·실행(길게 누르기 실측은 수동) |
| IMP19-T1 | IMP-19 | core: `tts.ts`(글 정리·언어 감지·기기 음성 고르기·OpenAI 합성·대체 안내) + 테스트 | lead | LOW | inherit | default | DONE | 100% | - | PASS: core tts 15 |
| IMP19-T2 | IMP-19 | ui: `voice/speak.ts`(기기/OpenAI·대체·캐시·iOS 깨우기), SelectionMenu [듣기]/[멈춤](모바일 5칸·데스크톱 500px), 설정 `SpeechSettings`(엔진·음성·키·미리 듣기), uiState `branch.tts`, e2e | lead | MEDIUM | inherit | default | DONE | 100% | T1 | PASS: e2e 듣기 2/2(desktop·mobile) |
| IMP20-T1 | IMP-20 | core `MobileSpeech`·`rankDeviceVoices`, mobile `@capacitor-community/text-to-speech`·`platform.ts` speech, ui `speakNative`(음성 순차 시도·안내), iOS AVAudioSession playback | lead | MEDIUM | inherit | default | DONE | 100% | IMP-19 | PASS: Android 에뮬레이터 실측(vi·ko 내장, en 내장 손상 → 온라인 대체, 멈춤), iOS 빌드 |
| IMP21-T1 | IMP-21 | core: `speak-block.ts`(블록 해석), `skill-match.ts`(요청 → 스킬), 기본 스킬 `/speak`·seed, mock 응답 + 테스트 | lead | MEDIUM | inherit | default | DONE | 100% | IMP-19 | PASS: core 358(+10) |
| IMP21-T2 | IMP-21 | ui: `speak.ts` 큐(`speakAll`·재생 key), `SpeakCard.tsx`, Markdown `pre` 분기, Composer 자동 칩·빼기, 설정 `AutoSkillField`(PC·원격), e2e speak.spec | lead | MEDIUM | inherit | default | DONE | 100% | T1 | PASS: e2e speak 4/4(desktop·mobile) |
| IMP21-T3 | IMP-21 | 독립 리뷰·반영·검증·패키지 앱·문서 | reviewer+lead | MEDIUM | inherit | default | DONE | 100% | T2 | PASS: 아래 Latest Integration Result |
| IMP22-T1 | IMP-22 | core `createSubSession`·`footnoteChildren`·앵커 없는 맥락·sync op `subsession` + 테스트, ui `SubSessionDialog`·사이드바 [+]·`Footnotes`·ChatNav 각주 고정, e2e subsession | lead | HIGH | inherit | default | DONE | 100% | - | PASS: e2e subsession desktop·mobile |
| IMP23-T1 | IMP-23 | core `vault.ts`·모델·store·repo·persist(Dexie v5)·sync `vault.put/delete`·`sync.vault` 페이징·백업 + 테스트 | executor+lead | HIGH | inherit | default | DONE | 100% | - | PASS: core 384 |
| IMP23-T2 | IMP-23 | ui `VaultOverlay`(트리·상세·페이지 편집)·`save.ts`·TopBar [보관함]·답변/선택/이미지/읽기 카드 [보관], e2e vault | lead | HIGH | inherit | default | DONE | 100% | T1 | PASS: e2e vault desktop·mobile |
| IMP24-T1 | IMP-24 | ui `navDock.ts`(+테스트)·ChatNav 모바일 도크(끌기·스냅·메뉴)·SessionHeader `NavRestoreButton`, e2e nav-handle | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: e2e nav-handle mobile |
| IMP22-24-T9 | IMP-22~24 | 독립 리뷰·반영·검증·패키지 앱·문서 | reviewer+lead | MEDIUM | inherit | default | DONE | 100% | 위 전부 | PASS: 아래 Latest Integration Result |
| IMP26-T1 | IMP-26 | core `beside`·`pageRows`·`placePageBlock`·`setPageBlockBeside`·`normalizePageBlocks`·`removePageBlock` + 테스트 | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: core vault 테스트 |
| IMP26-T2 | IMP-26 | ui Modal size·스택, `drag.ts`·`pickers.tsx`·`shared.tsx`·`PageEditor.tsx`, VaultOverlay(전체 화면·트리 끌기·도구 모음·저장·미저장 확인), e2e vault | lead | HIGH | inherit | default | DONE | 100% | T1 | PASS: e2e vault desktop·mobile, 스크린샷 mobile·tablet·desktop |
| IMP26-T3 | IMP-26 | 독립 리뷰·반영·검증·패키지 앱·문서 | reviewer+lead | MEDIUM | inherit | default | DONE | 100% | T2 | PASS: 아래 Latest Integration Result |
| IMP27-T1 | IMP-27 | core `order`·`placeVaultNode`·`vaultChildren` 정렬·검증 + 테스트, ui 트리 놓을 자리(앞/뒤/안으로) 선 표시, e2e vault 순서 바꾸기 | lead | MEDIUM | inherit | default | DONE | 100% | - | PASS: core 399, e2e vault desktop·mobile |

## Active Work
- 없음 (IMP-29 완료)
- 확인 필요(수동): iOS 실기기에서 무음 스위치 켠 상태로 [듣기], Android 실기기 베트남어 음성(B-08)
- 병합 주의: 다른 세션의 IMP-13(브랜치 `imp-13`, ADR-039)이 sync host·client·`isSyncSkill`·skillsStore를 바꿨다 — 병합 시 IMP-12 Skill `files`/`options`가 그 검증을 통과해야 한다
- 확인 필요: Windows에서 core `sync.reset`·`자동 제목` 2건, bridge 19건, relay 2건 테스트가 IMP-08 이전 코드에서도 실패(macOS 기준 통과 기록). 원인 미조사

## Blockers
- 없음 (docs/BLOCKERS.md 참조)

## Decisions
- docs/DECISIONS.md 참조

## Latest Integration Result
- 2026-10-19 · 앵커 없는(빈) 하위 세션도 헤더의 [부모에 요약 붙이기] 줄을 접기(부모 원문 접기와 같은 기기별 상태, 접으면 헤더 ✨ 아이콘). `pnpm typecheck`·`pnpm lint`·`pnpm test` PASS, `pnpm e2e` 89 passed·11 skipped(새 subsession 접기 desktop·mobile), skill-sync-split 2건은 기존 실패. 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-19 · 사이드바 하위 세션의 하위 세션 접기 토글(▸, 접으면 `+N`, 열린 세션이 안에 있으면 자동 펼침). `pnpm typecheck`·`pnpm lint`·`pnpm test` PASS, `pnpm e2e` 86 passed·11 skipped(새 branch-collapse desktop·mobile). 실패 3건: skill-sync-split 2건은 기존 문제, annotations(mobile) 1건은 단독 재실행 PASS(간헐). 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-19 · 질문 우클릭 → 하위 세션으로 분리(ADR-065): core `planTurnSplit`·store `splitTurn`·sync op `turn.split`(기능 `split`), ui 우클릭 메뉴 [하위 세션으로 분리](첫 질문 비활성). `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 410(+7)·ui 64·bridge 59·relay 9·server 10 PASS, `pnpm e2e` 85 passed·11 skipped(새 turn-split desktop·mobile), skill-sync-split의 '웹(원격) 스킬 동기화 버튼' 2건 실패 — 이 변경 전에도 실패(기존 문제). 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-19 · 웹·모바일 여러 PC 연결 목록(ADR-063): core `bridge/hosts.ts`(+4 테스트), ui `sync.ts` 저장 목록·`switchHost`·`forgetHost`, `HostList.tsx`(메인 화면·설정). `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 403·ui 55·bridge 59·relay 9·server 10 PASS(core `sync.reset` 테스트가 전체 실행에서 간헐 실패 2회 — 단독·재실행 PASS, 코드 무관), `pnpm e2e` 85 passed·11 skipped(새 host-list 2). 모바일 스크린샷 확인. iOS·Android 네이티브 빌드는 안 함.
- 2026-10-19 · VS Code 팔레트, 한국어 조사가 붙은 `**강조**` 렌더링(remark-cjk-friendly), 웹·모바일 PC별 스킬 목록·연결 시 자동 동기화(ADR-064, Dexie v6 `hostSkills`). `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 403·ui 64·bridge 59·relay 9·server 10 PASS.
- 2026-10-16 · 마지막 페이지 기억: 보관함·스킬·이해 노트 중 열어 둔 페이지를 기기별(localStorage `branch.lastPage`)로 기억해 앱을 다시 켜면 연다(닫으면 잊음, 검색·설정·데모·세션 창 제외). 열린 세션·분할은 기존 view 저장으로 이미 복원. `pnpm typecheck`·`pnpm lint`·`pnpm test` PASS, `pnpm e2e` 81 passed(새 last-page desktop·mobile). 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-16 · IMP-29 드래그 메뉴 선택 글 고치기(ADR-061): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 399·ui 51·bridge 59·relay 9·server 10 PASS, `pnpm e2e` 71 passed·11 skipped(새: 고친 글 → [질문에 첨부]·[이게 뭐야?] desktop·mobile). 스크린샷 확인. 패키지 데스크톱 앱 재빌드·재실행.
- 2026-10-16 · IMP-28 사이드바 너비·분할창 이동 끌기·드래그 메뉴·질문에 첨부(ADR-060): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 399·ui 51(+2) PASS, `pnpm e2e` 69 passed·11 skipped(새: 드래그 메뉴 글자 한 줄·[질문에 첨부] 인용, 이동 버튼 끌어 자리 바꾸기, 사이드바 끌기·저장·더블클릭 초기화). 패키지 데스크톱 앱 재빌드·재실행.
- 2026-10-16 · IMP-27 보관함 트리 놓을 자리 선·순서 바꾸기(ADR-059): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 399(+7)·ui 49·bridge 59·relay 9·server 10 PASS, e2e vault desktop·mobile PASS(폴더 줄 위쪽 가장자리로 끌면 선 표시 → 놓으면 페이지가 폴더 앞으로). 스크린샷 확인. 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-16 · IMP-26 보관함 UI/UX 개편(ADR-058): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 392(+8)·ui 49·bridge 59·relay 9·server 10 PASS, `pnpm e2e` 65 passed·9 skipped(vault desktop·mobile: 높이 80%·전체 화면, 블록 손잡이 끌어 나란히, 미저장 확인, 트리 끌기 → 폴더·맨 위, [이동] 폴더 선택, [저장]). 스크린샷 mobile·tablet(820)·desktop 확인. 독립 리뷰: 끌기 중 블록 목록 최신값 사용 반영, "편집 중 지우기 미저장 확인 누락"은 편집 중 도구 모음이 [저장]/[취소]로 바뀌어 해당 없음, 놓은 뒤 click 삼키기 리스너는 once·다음 틱 제거로 무해. 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-16 · IMP-22~24 하위 세션 각주·보관함·모바일 내비 핸들(ADR-054~056): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 384(+23)·ui 49(+2)·bridge 59·relay 9·server 9 PASS, `pnpm e2e` 65 passed·9 skipped — 새 subsession·vault(desktop·mobile)·nav-handle(mobile). composer-split 선택자를 가지 행 구조 변경에 맞춤. 독립 리뷰 반영: 빈 글 블록은 보기로 바꿀 때 치움, `moveVaultNode` 정리(나머지 지적은 의도된 동작 확인). 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-16 · OpenAI 읽기 언어별 탭·베트남어 남부/북부 억양·공통 모델 선택(ADR-053): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 361(+3)·ui 47·bridge 59·relay 9·server 9 PASS, `pnpm e2e` 60 passed·8 skipped(새 speak.spec: 남부 억양 지시·tts-1 전환 시 음성 맞춤·지시 없음·저장값). 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-16 · IMP-21 음성으로 읽기 스킬·읽기 카드·자동 스킬(ADR-052): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 358(+10)·ui 47·bridge 59·relay 9·server 9 PASS, `pnpm e2e` 58 passed·8 skipped — 새 speak.spec desktop·mobile: "발음 들려줘" 입력 → 자동 칩 → 보내기 → 스킬 배지·읽기 카드(3줄, 원본 JSON 숨김) → 줄 듣기(vi-VN) → 모두 듣기(vi·vi·en 순서) → 칩 빼고 보내면 스킬 없음 → 설정에서 끄면 칩 없음. 전체 실행 1회에서 annotations 메모 테스트(mobile) 타이밍 실패 → 단독 8회 PASS(변경 전 코드도 동일)·전체 재실행 PASS. 수정: Markdown이 speak.ts를 가져오며 ui 단위 테스트(node)에서 `window` 참조 실패 → runtime `hasScenarioHash` 가드. 독립 리뷰: 차단 0 → "이야기 들려줘" 오탐 제외 반영. 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-15 · IMP-20 모바일 앱 발음 듣기(ADR-051): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 348(+1)·ui 47·bridge 59·relay 9·server 9 PASS, `pnpm e2e` 54 passed·8 skipped. Android 에뮬레이터(API 36) 실측: WebView `speechSynthesis` 없음 확인, 네이티브 음성 472개, 설정 › 음성 [베트남어 들어 보기] 내장 vi-VN 재생·[영어 들어 보기] 내장 en-US 데이터 손상(-4) → 온라인 en-US 대체 재생, [멈춤] 동작, ko-KR 재생. iOS 시뮬레이터 빌드 성공(플러그인 SPM 포함).
- 2026-10-15 · IMP-19 발음 듣기(ADR-050): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 347(+15)·ui 47·bridge 59·relay 9·server 9 PASS, `pnpm e2e` 54 passed·8 skipped — 새 듣기 테스트 desktop·mobile: OpenAI 키 없음 → 요청 0건·안내 토스트·기기 음성(ko-KR), 설정 › 음성에서 키 저장 → 429 → "사용 한도" 안내·기기 음성 대체·요청 1건. 스크린샷: 모바일 메뉴 5칸·설정 화면(데스크톱·모바일) 확인. 패키지 데스크톱 앱 재빌드·실행.
- 2026-10-15 · IMP-18 복사 버튼·모바일 시스템 메뉴 숨김(ADR-049): `pnpm typecheck`·`pnpm lint`·`pnpm test` PASS, `pnpm e2e` 52 passed·8 skipped(새 복사 테스트 desktop·mobile: 클립보드에 선택 글, "복사됨" 후 메뉴 유지). Android 에뮬레이터(dev 서버 연결 앱): 본문 길게 눌러 선택 → 시스템 메뉴 없음·선택 유지·우리 메뉴 4칸, [복사] 후 키보드 클립보드 제안에 선택 글 → 입력창에서는 붙여넣기 메뉴 정상 → 입력 후 본문 선택 시 다시 숨김. `/quiz` 카드가 모바일 앱에서도 렌더·풀이(정답·해설). iOS 시뮬레이터(iPhone 15 Pro): 빌드·설치·실행·화면 로드 PASS, 길게 누르기 메뉴 실측은 자동화 권한(손쉬운 사용) 없어 미확인 → 실기기 수동 확인(B-08).
- 2026-10-15 · IMP-17 퀴즈(ADR-048): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 332·ui 47·bridge 59(+3)·relay 9·server 9(+1) PASS(전체 실행 1회에서 core `sync.reset` 타이밍 실패 → 단독 3회·전체 재실행 PASS, 변경과 무관), `pnpm e2e` 50 passed·8 skipped(패키지 전용) — 새 quiz.spec: OX 정답 → 객관식 오답(정답 2번·해설·수식) → 주관식 인정 답 → 2/3 점수 → 새로고침 유지 → 카드 뒤 문장으로 가지(앵커 정확) → 다시 풀기. 독립 리뷰: 차단 0, 모바일 터치 영역 1건 반영. 스크린샷 검증 중 발견·수정: 정답 "2. 보기"가 마크다운 목록이 되던 문제, `.md ol` 번호가 보기에 겹치던 문제, 고른 보기 강조가 약하던 문제.
- 2026-10-15 · IMP-16c 헤드리스 server 음성 입력(ADR-047): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 326·ui 47·bridge 59(+3 skipped)·relay 9·server 9(+1 skipped; 원격 기기가 서버 음성 설정 켜기·모델 선택·받기 → 전사, `stt: false`면 미지원 응답) PASS. 실제 스모크(빌드 산출물 `dist/rhymebook.cjs serve --pair`, 임시 `--dir`): 시작 화면에 "음성 입력: 꺼짐 · 모델 기본 (정확) (받지 않음) · whisper-cli 없음 — brew install whisper-cpp …" 표시 → 웹(390px)을 주소+코드로 페어링 → 설정 › 음성 입력에서 켜기·가벼운 모델 선택이 서버 `stt/settings.json`에 반영, [받기] 진행률 32% → [취소] 후 `models/` 비어 있음 → 끄기 반영. 이 Mac에는 whisper-cli가 없어 서버 실제 전사는 가짜 whisper 통합 테스트로 확인.
- 2026-10-15 · IMP-16b 원격 음성 설정 관리(ADR-046): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 326·ui 47·bridge 59(+3 skipped, 5회 반복 안정)·relay 9·server 7(+1 skipped) PASS, `pnpm e2e` 48 passed · 8 skipped. 실제 스모크: `package:dir` 앱(격리 userData)을 호스트로, 웹(390px)을 주소+코드로 페어링 → 설정에 음성 관리 화면 → 토글·가벼운 모델 선택이 PC에 반영, [받기] 후 진행률 35%(PC `download`와 일치)·다른 모델 [받기] 비활성 → [취소] 후 PC `download: null`.
- 2026-10-15 · IMP-16 음성으로 질문하기(ADR-045, macOS): `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 325·ui 47·bridge 55(+3 skipped)·relay 9·server 7(+1 skipped) PASS, `pnpm e2e` 48 passed · 8 skipped. 독립 리뷰 지적 반영: 녹음 준비 실패 시 마이크 해제, WAV 헤더 길이(RIFF·data) 확인, 전사 대기 4건 제한, whisper-cli에 필요한 환경 변수만 전달(+회귀 테스트 3). 실제 스모크(`package:dir` 앱 번들 whisper-cli v1.9.5 Metal, 가벼운 모델): 엔진 직접 전사 2.4s "안녕하세요, 이젠 탐색트리의 시간 복잡도를 설명해 주세요."; 패키지 앱에서 설정 › 음성(켜짐·받음) → 입력창 마이크 → 실제 한국어 음성(getUserMedia 주입) 5초 녹음 → 798ms 후 입력창에 전사문. 무음 녹음은 보내지 않음(가짜 장치 무음 → whisper '고맙습니다' 환각을 막으려 무음 차단 추가). 남은 것: B-11(타 플랫폼 번들·서명), B-12(실기기 마이크).
- 2026-10-14 · IMP-15 Codex 이미지 생성(ADR-041): `pnpm typecheck`·`pnpm lint` PASS. `pnpm test`는 core 296, ui 47, bridge 44(+3 skipped), server 7(+1 skipped), relay 9 PASS. 가짜 codex로 확인한 항목: generated_images 수집, 이벤트 순서 delta→image→done, 폴더 삭제, 제목 요청에서는 꺼짐, 1MB 넘는 PNG의 JPEG 재압축.
- 2026-10-14 · IMP-14 `rhymebook serve` 헤드리스 호스트(macOS): 새 패키지 `packages/server`(bin `rhymebook`: serve/pair/devices/unpair). `pnpm typecheck`·`pnpm lint` PASS, `pnpm test` core 293·ui 47·bridge 41(+3 skipped)·server 7(+1 skipped 수동 스모크)·relay 9 PASS, `pnpm e2e` 44 passed · 8 skipped. 실제 스모크(빌드 산출물, 실제 claude CLI): 스크립트 클라이언트 페어링 → 새 학습·질문 → "1+1은 2입니다." 스트리밍·저장 → Ctrl+C 정상 종료 → 재시작 후 재연결·데이터 유지. 웹 UI(`pnpm dev`, 390px)에서 "내 PC와 연결하기"에 링크 붙여 넣어 페어링 → 새 학습 질문 → PC CLI 답변 "파란색" 수신, 서버 data.json에 2개 학습 저장. 스모크 중 발견: `--name` 없이 재시작하면 저장된 이름이 컴퓨터 이름으로 덮임 → 수정·회귀 테스트. 첫 실행 강제 종료(SIGKILL)에도 data.json(0600)·예시 스킬 생성 확인. 데스크톱 `package:dir` 재빌드·실행.
- 2026-10-14 · 개선(질문 삭제, Windows): 대화 목차의 휴지통 버튼·세션 본문 우클릭 "질문 삭제"로 질문+답변 삭제(답변에서 뻗은 가지·서식 함께 삭제, 첫 질문은 삭제 불가, 응답 중 불가). core `deleteTurn`·`turnMessageIds`, sync op `turn.delete`(PC "원격에서 학습 삭제 허용"을 따름). `pnpm typecheck` PASS, lint는 `.claude/worktrees/imp-13` 1건 외 PASS, core 282/284(실패 2 기존 `sync.reset`·자동 제목), ui 47/47, bridge 실패 19는 변경 전과 동일(Windows 환경). Windows `package:dir` 재빌드.
- 2026-10-14 · 개선(세션 SVG 이미지 출력, Windows): 기존 답변의 SVG/XML/HTML/언어 없는 코드 블록·단독 SVG를 이미지로 렌더하고 원본 코드 펼침 제공. SVG 원문과 가지 offset 유지, 미완성/깨진 SVG는 코드 표시. 단독 SVG 빈 줄·중첩·수식 구분자·앞 코드 예시 회귀 수정(독립 리뷰 완료). `pnpm typecheck` PASS, 변경 파일 eslint·diff check PASS, ui 47/47, SVG E2E desktop/mobile 4/4, 390/1440 스크린샷 확인. 실행 중 기존 앱의 app.asar 잠금으로 기본 `package:dir` EBUSY → 기존 앱을 종료하지 않고 별도 `apps/desktop/release/svg-preview/win-unpacked/rhymebook.exe` 패키징 PASS. 격리 userData에서 실제 패키지 앱 SVG smoke 1/1 PASS·스크린샷 확인. 실행 중인 기존 앱에는 재시작 후 새 빌드를 사용해야 적용됨. 계획: docs/plans/svg-preview-plan.md.
- 2026-10-14 · 개선(IMP-12 스킬 파일·폴더·전용 provider/모델/노력치, Windows): `pnpm typecheck` PASS, eslint(packages·apps·e2e) PASS — 루트 `pnpm lint`는 다른 세션 워크트리 `.claude/worktrees/imp-13`의 미사용 변수 1건으로 실패. core 274/276(+skill-files·skill-assist 신규, 실패 2는 기존 `sync.reset`·자동 제목)·ui 36/36, e2e `skill-assist` 4/4(desktop·mobile, `CI=1`로 단독 서버 — 다른 세션 e2e 서버 재사용 시 실패했음). 독립 리뷰 지적(긴 파일 AI 덮어쓰기, 앱이 모르는 파일·frontmatter 삭제, 이름 변경 시 바이너리 삭제, 편집 중 폴더 변경 덮어쓰기, 지운 스킬 부활, 이름 정규화 반복, 미닫힘 파일 태그, 원격 칩) 반영. Windows `package:dir` → 격리 userData Playwright `_electron` 스모크 PASS: 시작 시 폴더 생성, 저장 → SKILL.md 옵션·파일 기록, 폴더 수정·추가 파일·Claude 형식 폴더 가져오기, 가져온 스킬 저장 시 `allowed-tools` 유지, 삭제 후 되살아나지 않음.
- 2026-10-14 · 개선(원격 AI 스킬 도우미·메뉴 막대, Windows): 웹·모바일 스킬 AI 도우미는 기기 기본 provider 대신 `remote-bridge`(PC 원격 설정 = `applyHostPolicy`)로 작성, PC 미연결이면 안내. 데스크톱 창 메뉴 막대 제거(Windows/Linux `setApplicationMenu(null)`, macOS는 앱·편집·창 역할 메뉴만). `pnpm typecheck`·`pnpm lint` PASS, ui 36/36. Windows `package:dir` 실행 — 창 메뉴 핸들 0 확인.
- 2026-10-15 · 개선(책 PDF, ADR-044): `/book` 세션 헤더 [책 PDF] — A5 양면 조판(표지·속표지·차례 쪽 번호·장 여는 쪽·쪽마다 머리글·핵심 정리 상자·판권), 데스크톱은 숨은 창 Chromium 2회 인쇄(1차 PDF의 이름 있는 목적지로 차례 쪽 번호 채움), 웹은 인쇄 창, 모바일은 인쇄용 HTML 공유. `pnpm typecheck`·`pnpm lint` PASS, core 316(+4 book)·ui 47·bridge 45·relay 9·server 7 PASS, `pnpm e2e` 46 passed. 샘플 책(3장·수식·표·코드) 19쪽 PDF 생성 ~0.8초, 차례 쪽 번호·머리글·KaTeX 렌더 확인. 독립 리뷰: 지적 5건 검토 — 글꼴 대기(executeJavaScript는 Promise를 기다림)·CSS 문자열·원격 로드는 해당 없음, 추가로 시간 초과 시 인쇄 창 즉시 닫기 반영. 데스크톱 `package:dir` 재빌드·실행.
- 2026-10-15 · 개선(학습 꾸러미·책으로 만들기, ADR-043): 이해 노트 [학습 내보내기](zip: README·세션별 md·study.json)·[학습 가져오기](세션별 최근 우선 합치기, 원격은 sync op `study.import`, 덮어쓰기는 원격 삭제 허용 필요)·[책으로 만들기](새 루트 "📖 제목" + 학습 원문 첨부 + 내장 스킬 `/book`). 내장 스킬 시드를 id 목록으로(기존 사용자에게 `/book` 1회 추가). 이해 노트 버튼은 학습이 없어도 보임(가져오기 전용). 독립 리뷰 low 3건 반영. `pnpm typecheck`·`pnpm lint` PASS, core 312·ui 47·bridge 45·relay 9·server 7 PASS, `pnpm e2e` 46 passed(+2 학습 꾸러미).
- 2026-10-14 · 개선(앱 복귀 1회 자동 재연결, ADR-042): 모바일 `appStateChange`·웹 `visibilitychange` 복귀 시 sync client `resume()` — offline이면 1회 재연결, 복귀 직후 5초 안의 끊김도 1회 재연결, 60초 넘게 백그라운드면 새 연결. 실패하면 토스트, 연결 중에는 상단 PC 칩에 스피너와 '연결 중'(모바일 포함). 원격 링크 `reset()` 뒤 늦은 닫힘이 새 연결을 끊던 경합 수정. `pnpm typecheck`·`pnpm lint` PASS, core 300(+4 resume)·bridge remote +1 PASS(`sync.reset` 기존 간헐 실패 1/16), `pnpm e2e` 44 passed.
- 2026-10-14 · 개선(원격 수동 재연결·빈 화면 문구, Windows): 웹·모바일 sync client `autoReconnect: false`(끊기면 offline 유지, [다시 연결]로만), 학습이 있는데 선택이 없을 때 "이어서 볼 학습을 골라 주세요"+[학습 목록 열기]. `pnpm typecheck`·`pnpm lint` PASS, core sync +1 테스트 PASS(실패 `sync.reset`·store auto title은 변경 전과 동일 계열).
- 2026-10-13 · 개선(IMP-10, Windows): `pnpm typecheck`·`pnpm lint` PASS, core 251/253(실패 2 기존 동일)·ui 36/36, bridge 19·relay 2 실패 기존 동일. e2e `--workers=2` 33 passed · 5 skipped(기본 병렬 실행은 느린 머신에서 타임아웃 12건 — 단독·2 worker 재실행 시 통과). Windows `package:dir` → 격리 userData Playwright `_electron` 조작으로 5개 기능 확인. 알려진 점: 가지 헤더 부모 원문 인용은 수식 원문(`\(d_k\)`)을 그대로 보여 준다.
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
- 보관함·메시지 동기화: 큰 이미지(5MB 첨부 ≈ base64 6.7MB)는 WebSocket 프레임 한도에 걸릴 수 있음(기존 첨부 동기화와 같은 한계).
- `rhymebook serve`: 데스크톱 앱과 데이터를 공유하지 않음(별개 호스트). `unpair`는 실행 중인 serve를 다시 시작해야 연결이 끊김. 원격 기기는 PC 스킬을 읽기만 하며 스킬은 `<데이터 폴더>/skills/`를 직접 편집. 터미널 주소 목록의 한글 라벨 정렬이 약간 어긋남(표시만).
- relay 실행: `pnpm relay` (기본 :8787) + `pnpm bridge -- --pair --relay ws://<relay>:8787 [--relay-only]`. 공개 배포는 TLS 프록시 뒤 wss(B-09).
- 모바일 실행: `pnpm --filter @branch/mobile build:android` / `build:ios-sim` (Android Studio·Xcode 필요, iOS는 Xcode › Settings › Components에서 iOS 플랫폼 설치). 앱 내 [QR 스캔](카메라 권한) 또는 OS 카메라 → `branch://pair` 딥링크로 페어링. Android minSdk 26.
- 모바일 상단 바에서 긴 세션 제목은 말줄임 처리됨(의도된 동작).
- E2E: `pnpm e2e` (최초 `pnpm exec playwright install chromium`). 데스크톱 패키징: `pnpm --filter @branch/desktop package` (미서명, B-03).
- (해결, Phase 1) 겹치는 앵커 위치 판정, indexOf 폴백 오매칭, 요약 초안 경합·에러 시 부분 텍스트 유실 → ADR-012/013.
- 데스크톱 실행: `pnpm --filter @branch/desktop build && pnpm --filter @branch/desktop start` (개발: Vite 서버 기동 후 `pnpm --filter @branch/desktop dev`).
- 웹 API 키는 탭 메모리 전용이라 새로고침 시 다시 입력해야 함(의도, 설정 경고 표시). 실제 키 검증은 B-02.
