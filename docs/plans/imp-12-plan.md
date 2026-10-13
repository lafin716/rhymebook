# IMP-12 스킬 관리 고도화 — 스킬 파일·폴더·전용 provider/모델/노력치

## 목표
1. Claude·Codex 스킬처럼 스킬에 부수 파일(references/·scripts/·assets/ 등 텍스트 파일)을 둔다. 앱에서 보고·만들고·고칠 수 있다.
2. 데스크톱은 스킬 폴더(`<userData>/skills/<name>/SKILL.md` + 파일)를 OS 탐색기로 열 수 있다. 폴더에서 고친 내용은 앱으로 돌아오면 반영되고, 폴더에 넣은 Claude 형식 스킬 폴더는 새 스킬로 가져온다.
3. AI로 스킬을 만들거나 고칠 때 필요하면 부수 파일도 만들거나 고치거나 지운다.
4. 스킬마다 고급 옵션: 전용 provider·모델·노력치. 비우면 세션 설정을 따르고, 정하면 그 스킬을 쓴 질문(그 턴)만 그 설정으로 답한다.

## 유지할 동작
- 스킬은 기기별 IndexedDB(ADR-034). 질문에는 보낸 시점 사본(SkillRef)이 실린다 → 사본에 files·options 포함.
- 원격(웹·모바일)은 PC 에이전트만 고를 수 있다(ADR-031) → 원격 피어가 보낸 스킬 옵션은 CLI provider일 때만 PC가 따른다.
- 기존 저장된 스킬(필드 없음)은 그대로 유효.

## 공통 계약 (core)
- `SkillFile { path; content }`, `SkillOptions { providerId; model?; effort? }`, `Skill.files?`, `Skill.options?`, `SkillRef`에도 동일 선택 필드.
- `isSkillFilePath`, `SKILL_FILE_LIMITS`(30개·파일 40,000자·합계 120,000자), `sanitizeSkillFiles`.
- `withSkill`: 지시 뒤에 파일 본문을 경로별 코드 블록으로 붙인다(스크립트는 실행 불가 — 내용 안내).
- `skillChatTarget(state, sessionId, has)`: 마지막 사용자 메시지 스킬의 옵션 → provider·모델·노력치. provider가 없거나 등록 안 됐으면 세션 설정.
- `skillFolder.ts`: `toSkillMd(skill)` / `parseSkillMd(text)` (frontmatter name·title·description·provider·model·effort + 본문).
- `DesktopApi.skills?`: `write(skill, prevName?)`, `remove(name)`, `open(skill)`, `readAll()`.
- AI 도우미 출력: `<file path="…">…</file>`, `<delete path="…"/>`.

## 소유권
- lead: core 모델·skills·skillAssist·store·sync/host·mock + ui 전부, 문서.
- agent-desktop: `apps/desktop/src/{main,preload,ipc}.ts`의 스킬 폴더 IPC + `apps/desktop/src/skillsDir.ts`(새 파일).
- reviewer: 통합 diff 독립 리뷰.

## 난이도·모델
- 전체 HIGH(다중 패키지·공개 프로토콜). lead 현재 모델(Opus 5.5) 상속, 서브에이전트 상속 — 별도 effort 선택 불가.

## 검증
- `pnpm typecheck && pnpm lint && pnpm test`(core 신규 테스트: 파일 경로·withSkill·skillChatTarget·SKILL.md 왕복·AI 파일 파싱), e2e `skill-assist`.
- Windows `package:dir` 빌드 후 패키지 앱에서 고급 옵션·파일·폴더 열기 확인.
