# 05 · Roadmap

## 진행 게이트
- **1단계** 설계 문서 → **2단계** UI 프로토타입(Mock) → **사용자 "컨펌"** → **3단계** Phase 1~7 자율 진행
- 2단계 보고 후 반드시 정지. "컨펌" 입력 전에는 3단계 작업을 시작하지 않는다.
- 2026-10-09 사용자 컨펌 완료 → 3단계 진행 중. Phase 2.5(백업)는 컨펌 시 함께 승인된 추가 범위.

## 3단계 진행 규칙
- 질문하지 않고 자율 결정 → DECISIONS.md 기록
- 사람 조치 필요 항목(인증서, CLI 로그인, API 키, 스토어 계정)은 스텁/모의로 우회 → BLOCKERS.md 기록 후 계속
- Phase 종료마다: `pnpm typecheck && pnpm lint && pnpm test` 통과 → 커밋 `phase-N: 요약` → PROGRESS.md 갱신
- 같은 실패 3회 반복 시 대안 선택·기록 후 진행
- 확정된 UX(04-UX-SPEC.md)는 변경하지 않는다

## Phases

| Phase | 내용 | 완료 기준 |
|---|---|---|
| 1 | core/ui 실기능화: F1~F7을 Mock 대신 실제 로직으로. AnthropicApiProvider, OpenAIApiProvider로 웹 동작 | 웹에서 API 키로 3단계 가지, 요약, 분할, 팝업, 마인드맵 동작 |
| 2 | Dexie 영속화 (Repository 구현 교체) | 새로고침 후 전체 트리, 앵커, 요약, 보기 상태 유지 |
| 2.5 | 백업(F9): core `BackupTarget` + 스냅샷/복원(합치기·교체) + 파일 + 구글 드라이브 + 암호화 + 자동 백업. GitHub 대상 포함 | 파일 내보내기→초기화→가져오기로 트리·앵커·요약 복원, Drive는 OAuth 클라이언트 미등록 시 BLOCKERS 기록 후 모의 검증 |
| 3 | apps/desktop Electron + packages/bridge 내장 + Claude/Codex CLI Provider, 설정의 CLI 상태 감지 실제 구현 | CLI 로그인 환경에서 스트리밍 동작, 미설치·미로그인 시 안내 표시 |
| 4 | bridge 헤드리스 모드 + 페어링(QR, 기기 키) + RemoteBridgeProvider (Tailscale/LAN 직접) | 웹에서 원격 bridge를 통해 CLI provider 사용 |
| 5 | apps/mobile Capacitor (iOS/Android 빌드 설정, 보안 저장소, 반응형 검증) | 시뮬레이터/에뮬레이터 빌드 성공 (불가 시 BLOCKERS 기록) |
| 6 | packages/relay: 아웃바운드 WS 중계 + E2E 암호화, 오프라인 시 대체 provider | NAT 뒤 bridge에 relay 경유 접속 |
| 7 | 마무리: 앵커 복원·맥락 구성 단위 테스트, 핵심 플로우 E2E(Playwright), README(플랫폼별 실행/빌드), electron-builder 패키징 설정 | 테스트 전체 통과, README로 각 플랫폼 실행 가능 |

## 최종 보고 항목
완료 항목, 남은 BLOCKERS, 사용자가 직접 해야 할 조치 목록, 다음 개선 제안 3가지
