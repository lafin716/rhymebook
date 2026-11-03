# 검증

- core: schedule strict JSON/date/repeat/한도/intent/과거 날짜, 하루/평일/주/월 반복과 missed tick, skill seed/auto match, completion callback success/error/abort/retry.
- ui: fake-indexeddb CRUD/claim concurrency/restart/dedup/errors, 알림 설정/권한/실패/중복.
- e2e: 예약 페이지 빈 상태→수동 등록→수정→정지/재개→삭제, chat 블록 자동 등록, due→실제 mock 응답, 새로고침 유지, 모바일/데스크톱 screenshot.
- pnpm typecheck; pnpm lint; pnpm test; pnpm build; targeted playwright.
- pnpm --filter @branch/desktop package:dir, 독립 데이터 경로로 실행 smoke. 실제 OS 배너 노출은 시스템 알림 권한에 좌우되므로 API 호출과 native 지원 증거를 구분.
- 외부 운영 배포 없음. 기존 국제화 변경으로 인한 실패는 원인/영향을 구분해 기록.
