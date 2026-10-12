# rhymebook (구 Branch Learn) — 프로젝트 규칙

가지치기 학습 채팅앱. 답변 속 텍스트를 선택해 서브세션(가지)을 만들고, 맥락을 상속하며, 요약을 부모에 되돌린다.

## 재개 절차 (컨텍스트 압축/새 세션 시 반드시)
1. 이 파일을 읽는다.
2. `docs/PROGRESS.md`에서 **현재 단계와 첫 미완료 항목**을 확인한다.
3. 필요한 설계 문서만 읽는다(아래 표). `git log --oneline -10`, `git status`로 실제 상태를 대조한다.
4. 미완료 항목부터 이어서 진행하고, 단계/항목 완료 시 PROGRESS.md를 갱신한다.

## 현재 단계
- **3단계: 전체 개발 — Phase 1~7 완료** (2026-10-10). 남은 것은 사람 조치(docs/BLOCKERS.md)와 개선 작업. 실행·빌드는 README.md 참조.
- 3단계에서는 질문 없이 자율 진행(결정은 DECISIONS.md, 사람 조치는 BLOCKERS.md).

## 문서 위치
| 문서 | 내용 |
|---|---|
| docs/00-VISION.md | 문제 정의, 핵심 가치, 타깃 |
| docs/01-PRD.md | 기능 F1~F8, MVP/범위 밖 |
| docs/02-ARCHITECTURE.md | 모노레포, 데이터 모델, 앵커 알고리즘, 상태 관리, 플랫폼 빌드 |
| docs/03-PROVIDERS.md | Provider 인터페이스, CLI/Bridge/Relay, **정책 원칙** |
| docs/04-UX-SPEC.md | 화면·인터랙션·반응형 (컨펌 후 확정, 이후 변경 금지) |
| docs/05-ROADMAP.md | Phase 1~7 및 완료 기준 |
| docs/PROGRESS.md | 진행 현황 (단일 진실 원천) |
| docs/DECISIONS.md | ADR |
| docs/BLOCKERS.md | 사람 조치 필요 항목 |

## 규칙
- 패키지: `packages/core`(플랫폼 무관, DOM/Node import 금지), `packages/ui`, `packages/bridge`, `packages/relay`, `apps/*`.
- TypeScript strict. 도메인 로직(앵커, 맥락 구성, 트리)은 core의 순수 함수 + Vitest 단위 테스트.
- **데스크탑 앱 우선**: 기능 확인·시연은 데스크탑 앱이 기본. 변경 후 `pnpm --filter @branch/desktop package:dir`로 다시 빌드하고 `apps/desktop/release/mac-arm64/rhymebook.app`을 실행해 보여준다(실행 중인 이전 앱은 먼저 종료). 웹 개발 서버는 보조.
- 실행: `pnpm dev` (host 노출, :5173). 검증: `pnpm typecheck && pnpm lint && pnpm test`, E2E `pnpm e2e`.
- 3단계 Phase 종료 시: 위 검증 통과 → 커밋 `phase-N: 요약` → PROGRESS.md 갱신.
- 같은 실패 3회 반복 시 대안 선택 후 DECISIONS.md 기록.
- **정책**: OAuth 토큰/인증 파일 읽기·추출 금지, 클라이언트 헤더 위조 금지. 구독은 사용자 본인의 공식 CLI 실행으로만 사용. 공개 배포 기본 provider는 API 키.
- 비밀 값(API 키, 페어링 키)은 로그/커밋/relay 평문에 남기지 않는다.
- UI 문구는 한국어. 모바일 퍼스트(<768px 모바일 규칙).
