# 예약과 로컬 알림

요청: 기본 예약 스킬, 대화의 날짜/반복 시간에 따른 자동 예약, 별도 관리 페이지, 기본 응답 완료 로컬 알림.

프로젝트 모드. 기존 dirty 국제화 변경 보존. 외부 배포/커밋은 범위 밖. 대상은 로컬 웹과 패키징된 Electron 앱.

## 완료 조건과 Task Graph

- S1 계약/설계 독립 검토 → S2 도메인/스킬, S3 알림, S4 예약 저장/실행/페이지 → S5 통합/독립 리뷰 → S6 실제 UI/패키지 smoke/문서.
- S2: 날짜 검증, 반복 주기, AI 블록 파싱, 기본 스킬과 의도 선택의 회귀 테스트.
- S3: 완료 응답만 1회 알림, 기본 켬, 기기별 끄기/권한/테스트, Electron native IPC와 웹 Notification fallback. 실패/취소/로드된 과거 응답은 제외.
- S4: 생성/수정/일시정지/재개/삭제/세션 열기, IndexedDB 영속화, 실행 시 선점, 세션 busy 시 대기, 재시작 시 누락된 회차 1회만 실행. 실행 오류 표시.
- S5/S6: typecheck/lint/unit/build, UI 조작 및 390/1440 screenshot, 독립 리뷰, desktop package:dir 및 실행 smoke.

## 소유권과 모델

리더: docs, core/store/index.ts 통합 hook, UI 예약 저장/실행, shared db/model/index.ts, App/Sidebar/main.
executor(domain): core/schedules.ts, core/skills.ts, core/skill-match.ts, core/test/schedules.test.ts와 관련 skill 테스트.
executor(notification): core/bridge/desktop.ts, desktop/main.ts/preload.ts/ipc.ts, UI notifications/**, settings/SettingsModal.tsx.
독립 critic: 읽기 전용 설계/최종 diff 리뷰. 하위 에이전트 재위임 금지. shared 파일 변경은 리더에 요청.
HIGH/ADVANCED/high 도메인과 실행 통합, MEDIUM/STANDARD/medium 알림/UI. 도구 role default 사용, 리더 모델 상속. 기존 explore 역할은 계정 미지원으로 실패하여 사용하지 않는다.

## 설계/공유 계약

자세한 계약: ARCHITECTURE.md. 검증: TEST_STRATEGY.md. 상태의 SSOT: ../../PROGRESS.md의 예약/알림 섹션.

UI: 기존 스킬 페이지와 같은 전체 overlay, sidebar 예약 버튼, 반응형 카드/폼. 기존 토큰과 컴포넌트 재사용. 새 이미지/의존성 없음. OS가 최종 알림 허용 여부를 결정한다.
