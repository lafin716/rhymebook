# IMP-14 · `rhymebook serve` — 헤드리스 호스트 (ADR-040)

## 목표
Electron·렌더러 없이 `rhymebook serve` 하나로 PC(서버)에 학습 데이터를 두고, 웹·모바일 앱이 페어링해 데스크톱과 같은 원격 기능(동기화 거울·질문·가지·요약·서식·스킬 목록·PC CLI 실행)을 쓴다.

완료 기준: 실제 `rhymebook serve`에 클라이언트가 페어링 → `sync.hello`/스냅샷 → 새 학습·질문 → 스트리밍 답변 수신 → 서버 재시작 후 데이터 유지.

## 범위
- 새 패키지 `packages/server`(`@branch/server`, bin `rhymebook`). 명령: `serve`, `pair`, `devices`, `unpair <id|all>`.
- 엔진: core `createAppStore` + `createRuntimeRegistry`(CLI는 프로세스 내 `BridgeServer` → `createBridgeProviders`) + core `createSyncHost` + bridge `createRemoteServer({sync})`. 새 로직 최소화, 기존 조각 조립.
- 저장: `<dir>/data.json` (StoredData, 디바운스 원자적 쓰기, 0600). `<dir>/skills/<name>/SKILL.md` 폴더를 읽어 원격 `sync.skills`로 제공(없으면 기본 예시 스킬).
- 페어링 정보: `<dir>/bridge` (identity·devices, 기존 BridgeStore).
- 기본 폴더: `RHYMEBOOK_HOME` → `$XDG_CONFIG_HOME/rhymebook` | `~/.config/rhymebook` (Windows `%APPDATA%\rhymebook`).
- API 키: 환경변수 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 메모리 SecretStore에만(로그·파일 금지).
- 옵션: `--port`(7777), `--host`(0.0.0.0), `--name`, `--dir`, `--relay`/`--relay-only`, `--agent auto|claude-cli|codex-cli`, `--no-delete`, `--pair`, `-v`.

## 범위 밖
- 데스크톱 앱과 같은 데이터 공유(데스크톱은 IndexedDB). 서로 다른 호스트로 취급한다.
- 헤드리스에서 스킬 쓰기·AI 스킬 편집(원격 클라이언트는 원래 PC 스킬을 읽기만 함).
- 백업·Google/GitHub 연동.

## 유지할 동작
- 데스크톱 앱·`branch-bridge` CLI 동작 변화 없음. `skillsDir.ts`를 `@branch/bridge`로 옮기되 데스크톱은 같은 함수를 import.
- 정책: OAuth/인증 파일 미접근. CLI는 사용자 본인의 공식 CLI 실행만. 비밀 값 로그 금지.

## 계약
- `createHeadlessHost(opts) → { store, remote, syncHost, bridge, addresses(), close() }` (engine.ts).
- `createFileRepository(file) → Repository & { load(): StoredData | null; flush(): Promise<void> }` (fileRepo.ts).
- `rootProvider`: `--agent`(또는 settings.hostAgent)가 auto가 아니면 그것, auto면 사용 가능한 claude-cli → codex-cli → anthropic-api → openai-api.

## 소유권 / Task
| Task | 내용 | 담당 | 난이도 |
|---|---|---|---|
| IMP14-T1 | skillsDir 이동(bridge export), fileRepo + 테스트 | lead | MEDIUM |
| IMP14-T2 | engine(헤드리스 조립) + CLI + 빌드 + E2E 테스트(가짜 CLI·실제 ws 페어링) | lead | HIGH |
| IMP14-T3 | 독립 리뷰(reviewer 에이전트) → 반영 | reviewer+lead | MEDIUM |
| IMP14-T4 | 실제 스모크(빌드 산출물 `rhymebook serve` + 원격 웹 클라이언트) · README·문서 | lead | MEDIUM |

파일 수가 적고 서로 의존이 직렬이라 구현은 리더가 순차로 한다(병렬 이익 없음). 모델: 현재 Claude(Opus) 상속, reasoning 기본.

## 검증
`pnpm typecheck && pnpm lint && pnpm test`, server 단위·통합 테스트, 빌드 산출물로 실제 serve + 원격 웹(`pnpm dev`) 페어링 스모크.
