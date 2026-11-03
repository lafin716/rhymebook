# 예약·알림 검증 기록

2026-11-03, 기존 국제화 변경을 보존한 공유 작업 트리에서 검증. 릴리즈/외부 배포/커밋은 하지 않음.

## 결과

| 검사 | 결과 | 증거 |
|---|---|---|
| 전체 단위·통합 | PASS: core 682, UI 95, bridge 66, relay 9, server 10 = 862 tests; 기존 4 skip | /tmp/scheduling-tests-network.log |
| 전체 typecheck | PASS: 7 workspace packages | /tmp/scheduling-typecheck-verified.log |
| 전체 lint | PASS | /tmp/scheduling-lint-final-pass.log |
| 전체 build | PASS: web, desktop, mobile 및 서버 패키지 | /tmp/scheduling-build.log |
| 실제 UI E2E | PASS: 8/8, desktop 1440×900, mobile 390×844 | /tmp/scheduling-e2e-final.log |
| Electron package:dir | PASS: 최종 앱 재패키징 | /tmp/scheduling-packaged-verified.log |
| 패키징 앱 smoke | PASS: 예약 페이지, renderer 예외 0, native supported=true, 잘못된 입력 거절 | /tmp/scheduling-native-smoke.log |

UI E2E: 자동 예약 JSON→실제 저장→기한 지난 예약 실행→응답 완료 알림 2회; 예약 재귀 생성 없음; 서로 다른 탭의 새 세션 예약 1회 실행; CRUD·과거 날짜 오류·정지/재개·재시작 유지·삭제·원격 제한. 브라우저 알림은 API stub으로 전달 횟수를 검증했으며 실제 OS 배너 증거와 구분한다. API/CLI의 실제 계정은 사용하지 않았다.

월말 31→28→31, DST 공백/중복, originAt 유지, 제목만 수정할 때 월말 기준 보존, pending 실행 복구, sourceMessageId 중복과 삭제 후 재생성 방지, 성공/실패/취소/재시도 hook, 예약 실행 provenance도 회귀 테스트에 포함한다.

스크린샷: /tmp/octobooks-scheduling-evidence/ 아래 테스트별 PNG. 리더가 모바일 폼·결과 대화·데스크톱 목록을 직접 확인했으며 잘림·겹침 없음. 패키징 앱 스크린샷: /tmp/scheduling-native-manager.png.

## 독립 검토와 수정

별도 리뷰어가 설계와 실제 구현을 읽고 지적한 항목을 반영했다.

- 월말 반복/편집 시 원래 일자 유실 → anchorDay/originAt 보존, 연속 계산/편집 회귀 테스트.
- claim 직후 종료 시 유실 → pending 회차 + 결정적 질문 ID + 영속화 후 완료, 복구 테스트.
- 예약 작업이 새 예약을 만드는 재귀 → 메시지 provenance + 생성 hook 차단, 실제 E2E.
- 여러 탭의 오래된 세션/메시지 → 단일 Web Lock 엔진, 실행 전 대상 세션/영수증의 DB 정본 확인, 두 탭 E2E.
- 미래 주제를 예약으로 오인 → 구체적 시간/반복/명시 예약 의도 요구, 날씨·여행 계획 음성 예제 테스트.
- 원격 알림 → 기존 streaming→done 전환만 관찰, 초기 로드/재연결 재생 제외.

최종 수정은 리더가 통합 검증했다. 별도 리뷰어 모델의 사용량 제한으로 최종 수정 이후 추가 재리뷰는 수행하지 못했다.

## 기존 검증 장애와 처리

기존 국제화 작업의 제거된 상수 import가 초기 빈 화면을 유발했다. mock/관련 테스트를 현재 함수 API로 맞추고 book.ts 번역 함수 shadow를 수정했다. 기존 sync.reset 테스트는 hello+낡은 loaded만 기다리는 race가 반복 재현되어 online까지 기다리도록 테스트 조건만 보완했다.

초기 typecheck는 비어 있던 기존 번역 사전 때문에 실패했으나 병행 국제화 작업이 반영된 최종 전체 typecheck는 통과했다. 별도 작업의 서버/파일 갱신이 검증에 간섭해 최종 E2E는 포트5194·mock8804·독립 결과 폴더, HMR 차단, 실제 UI가 로드한 모듈 URL을 쓰는 fixture로 격리했다. 일반 실행: `pnpm exec playwright test e2e/schedules.spec.ts e2e/schedule-chat.spec.ts --workers=1`.

## 실제 한계

native 알림 supported=true와 IPC 검증은 확인했으나 테스트 환경에서 show 결과는 false여서 실제 OS 배너 표시를 확인하지 못했다. OS 권한/방해금지 설정에 따라 달라진다. 모바일 네이티브 알림은 SDK 미설치로 미지원. 예약은 앱 실행 중에만 동작하며 원격 예약 CRUD는 제공하지 않는다. 기존 웹의 일반 사용자 대화를 여러 탭에서 동시에 보내는 문제까지 배타 제어하지는 않는다; 예약 엔진끼리는 하나만 실행한다.
