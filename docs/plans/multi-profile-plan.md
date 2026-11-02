# IMP · 멀티 프로필 — 모바일·웹 자체 사용 + PC 멀티 프로필 (ADR-103)

## 목표
- 모바일 앱·웹도 PC 없이 **이 기기에서** 쓸 수 있다(학습은 이 기기 IndexedDB, 답변은 API 키 provider).
- 기존에 페어링한 PC들은 그대로 남아 **연결 프로필**이 된다.
- 메인 화면(빈 채팅·PC 미연결 화면)에서 프로필을 고른다: [이 기기] · [저장한 PC들] · [PC 추가].
- 데스크톱도 같은 목록으로 [이 PC] 또는 다른 PC 미러링을 고를 수 있다.

## 완료 기준 (관찰 가능) — 2026-11-02 모두 충족 (e2e host-list, 스크린샷, 데스크톱 패키지 실행)
1. 모바일·웹에서 메인 화면의 [이 기기에서 쓰기]를 고르면 다시 시작한 뒤 로컬 학습 화면이 되고, 설정 → 연결에서 API 키를 넣어 질문할 수 있다.
2. 로컬 프로필에서 저장한 PC를 고르면 그 PC 미러링으로 바뀐다. 원격 프로필에서 PC↔PC 전환은 지금처럼 즉시.
3. 기존 사용자: 모바일·웹은 기본 원격(지금과 같음), 데스크톱은 기본 로컬. 저장한 PC 목록·활성 페어링은 그대로.
4. 데스크톱에서 다른 PC 프로필을 고르면 그 PC를 미러링하고, 이 PC의 호스트 엔진·세션 창·백업은 쉰다. [이 PC]로 돌아오면 원래대로.
5. 사이드바 아래 연결 표시에서 현재 프로필이 보이고 프로필 목록으로 갈 수 있다.
6. `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e` 통과, 데스크톱 `package:dir` 빌드·실행.

## 설계
- 프로필 = `'local' | 'remote'` (localStorage `branch.profile`, 비밀 아님). 원격일 때 어느 PC인지는 기존 활성 페어링(`REMOTE_PAIRING_SECRET`), 저장한 PC들은 기존 목록(`REMOTE_HOSTS_SECRET`).
- core `resolveProfile(kind, stored)`: 저장값 우선, 없으면 데스크톱 local / 웹·모바일 remote.
- core `platformCaps(kind, { profile })`: 웹·모바일 로컬 프로필은 `localCli:false, modelChoice:true, providers:['anthropic-api','openai-api']`.
- UI `remoteMode = !!sessionWindowId || profile === 'remote'` (시작 시 고정). 로컬↔원격 전환은 프로필 저장 → 동기화·호스트 정지 → 다시 시작(reload).
- 웹은 비밀 값이 탭 메모리라 다시 시작하면 페어링이 사라진다 → 웹 로컬에서 PC를 고르면 원격으로 바꾼 뒤 그 화면에서 페어링한다.
- 데스크톱 원격 프로필: `syncHost`를 만들지 않고(`sync` 없음 → 원격 기기는 not-ready), 세션 창 열기 숨김, 백업은 기존대로 꺼짐.

## 변경 파일 (단일 작성자: 리더)
- core: `platform.ts`(+테스트)
- ui: `app/capabilities.ts`, `app/sync.ts`, `app/ai.ts`, `skills/SkillExtras.tsx`, `session/SessionMenu.tsx`, `session/Sidebar.tsx`, `chat/EmptyChat.tsx`, `components/HostList.tsx`→프로필 목록, `onboarding/Onboarding.tsx`, `settings/RemoteSettings.tsx`
- e2e: 웹 로컬 프로필 전환 시나리오
- docs: DECISIONS(ADR-103), PROGRESS, 02-ARCHITECTURE

## 난이도·모델
- MEDIUM~HIGH (상태 경계 변경). 현재 실행: Claude Opus 5.5 단일 리더 순차 구현(같은 파일 겹침이 많아 병렬 이익 작음). 독립 리뷰는 별도 에이전트.

## 유지할 동작
- 원격 미러링·PC 전환·세션 창(ADR-036)·호스트 엔진·스킬 PC별 저장(ADR-064)·개발 서버 `?platform=` 화면 전환.
