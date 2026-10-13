---
name: make-release
description: rhymebook 릴리즈 배포 — 남은 수정사항 커밋·푸시, 버전 올리기(데스크톱·모바일·Android), v태그 푸시로 Release 워크플로 실행, 초안 릴리즈에 한국어 노트 작성 후 공개. "릴리즈 해줘", "배포해줘", "/make-release [버전]"에 사용.
argument-hint: "[버전, 예: 0.5.0 | patch | minor] (생략 시 변경 내용으로 판단)"
---

# rhymebook 릴리즈 배포

인자: `$ARGUMENTS` (비어 있으면 버전을 직접 판단)

릴리즈는 `.github/workflows/release.yml`이 `v*` 태그 푸시로 데스크톱(mac·win·linux)·Android를 빌드해 **초안(draft) 릴리즈**를 만든다. 이 스킬은 그 앞뒤(커밋·버전·태그, 노트 작성·공개)를 맡는다.

## 0. 환경 주의 (Windows)
- PowerShell 5.1은 네이티브 인자 속 `"`를 깨뜨린다 → 커밋 메시지는 **항상 파일로** 쓰고 `git commit -F <file>` (scratchpad에 UTF-8 BOM 없이 저장).
- 파일 수정은 `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`로 BOM 없이.
- 커밋 메시지 끝에는 시스템이 지정한 Co-Authored-By 줄을 붙인다.

## 1. 상태 점검
```
git status --short
git log --oneline -1 --decorate
git tag --sort=-creatordate | Select-Object -First 3
git log --oneline <직전 태그>..HEAD
gh release list --limit 3
```
- main이 아니면 멈추고 사용자에게 알린다.
- 미커밋 변경은 **diff를 먼저 읽고** 성격별로 나눠 커밋한다(기능 `improve: …`, 잡무 `chore: …`). 무엇인지 모르는 파일·비밀 값(.env, 키)이 보이면 커밋하지 말고 묻는다.
- 직전 태그 이후 커밋이 없으면 릴리즈할 게 없다고 알리고 끝낸다.

## 2. 검증
`pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm test }`
- typecheck·lint 실패 → 멈추고 고친다(또는 보고).
- test 실패는 docs/PROGRESS.md "Latest Integration Result"에 적힌 **기존 실패**(core `sync.reset…`·store auto title, bridge·relay 일부)와 같으면 진행, 새 실패면 멈춘다.

## 3. 버전 결정
- 인자가 버전이면 그대로. `patch`/`minor`면 직전 태그에서 올린다.
- 인자가 없으면: `improve:`/`phase-` 기능 커밋이 있으면 minor, 수정·잡무만이면 patch.
- 아래 3곳을 함께 바꾼다:
  - `apps/desktop/package.json` `"version"`
  - `apps/mobile/package.json` `"version"`
  - `apps/mobile/android/app/build.gradle` `versionName "<버전>"`, `versionCode`는 **+1**
- 커밋: `chore: v<버전> — <주요 변경 짧게 · 로 나열>`

## 4. 푸시·태그
```
git push origin main
git tag -a v<버전> -m v<버전>
git push origin v<버전>
gh run list --workflow release.yml --limit 1
```
태그 푸시는 공개 배포의 시작이다. 사용자가 이번 요청에서 릴리즈를 명시적으로 시켰을 때만 실행한다.

## 5. 빌드 대기
- `gh run watch <runId> --exit-status --interval 30`을 **백그라운드**로 실행하고 기다린다(보통 4~10분).
- 실패하면 `gh run view <runId> --log-failed | Select-Object -Last 80`으로 원인을 보고 고친다. 고친 뒤에는 태그를 새 커밋으로 옮긴다:
  `git tag -d v<버전>; git push origin :refs/tags/v<버전>` → 남은 초안 릴리즈가 있으면 `gh release delete v<버전> --yes` → 4단계 다시.

## 6. 릴리즈 노트 작성·공개
- 워크플로가 만든 초안(`gh release view v<버전>`)의 자산을 확인한다: mac `.dmg`/`.zip`, Windows `.exe`, Linux `.AppImage`/`.deb`, Android `.apk`(+`.aab`).
- 직전 태그 이후 커밋 메시지(본문 포함, `git log --format="%s%n%b" <직전>..v<버전>`)와 docs/DECISIONS.md·PROGRESS.md를 바탕으로 **사용자 관점의 한국어 노트**를 쓴다. 형식은 이전 릴리즈(`gh release view <직전 태그> --json body`)를 따른다:
  - `## 새 기능` → `### 영역` 별 bullet(무엇을 할 수 있게 됐는지, "~해요" 체)
  - 원격 프로토콜(sync op 등)이 바뀌었으면 "**PC 앱도 <버전>으로 업데이트해야 해요.**"
  - `## 설치 파일` 표 (실제 자산 이름으로)
  - `**Full Changelog**: https://github.com/lafin716/rhymebook/compare/v<직전>...v<버전>`
- 노트를 scratchpad 파일로 쓰고 공개:
  `gh release edit v<버전> --notes-file <file> --draft=false --latest`
- `gh release view v<버전> --json isDraft,url`로 공개됐는지 확인한다.

## 7. 마무리
- docs/PROGRESS.md에 릴리즈 한 줄을 남기고 싶으면 다음 작업 커밋에 함께 넣는다(릴리즈 태그 뒤 별도 커밋을 만들지 않아도 된다).
- 사용자에게 보고: 버전, 포함된 커밋 요약, 릴리즈 URL, 서명 여부(secrets 없으면 미서명 빌드 — BLOCKERS B-10), 테스트에서 남은 기존 실패.
