# i18n 계획 (ADR-105)

목표: 설정에 언어(ko 기본, en) 추가, 설치 후 첫 실행 시 언어 선택 창, 모든 사용자 문구를 언어별 JSON으로 분리.

## 완료 기준
- 설정 → 일반(원격 모드: 화면)에 언어 선택. 바꾸면 저장 후 다시 불러와 전체 문구가 바뀐다.
- 새 설치(저장소 비어 있음)에서 언어 창 → 고른 뒤 기존 시작 안내. 기존 사용자는 묻지 않고 ko.
- 화면·트레이·오류·CLI·LLM 프롬프트·기본 스킬/시드 문구가 `packages/core/src/i18n/locales/<lang>/<ns>.json`에서 나온다. en은 ko와 키·자리표시자 동일(테스트가 검사).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` 통과, 데스크톱 앱에서 ko/en 확인.

## 상태 (2026-11-03)
I1~I6 DONE — docs/PROGRESS.md "다국어(i18n)" 절 참고.

## 공통 계약 (리더 소유)
- core: `t(key, vars)`, `getLocale/setLocale`, `intlLocale()`, `LANGUAGES`, `MessageKey` (`packages/core/src/i18n/index.ts`).
- UI: `packages/ui/src/i18n` — `init.ts`(main.tsx 첫 import), `index.tsx`(`t`, `tx`, `useLocale`), `LanguagePrompt.tsx`; `settings/LanguageField.tsx`.
- 데스크톱: `DesktopApi.setLocale?` → IPC `app:set-locale` → main에서 core `setLocale` + 트레이 갱신.
- e2e: `playwright.config.ts` storageState로 `octobooks.locale=ko` 미리 지정. `e2e/language.spec.ts`가 첫 실행 창을 본다.

## 문구 추출 배정 (동시 작성자 1명)
| 담당 | 파일 | 이름공간 |
|---|---|---|
| A | ui settings/ (LanguageField 제외), onboarding/, backup/, voice/ | settings, onboarding, backup, voice |
| B1 | ui chat/ 페이지 편집기: Page*.tsx, page*.ts, ColorPalette, livePreview | page |
| B2 | ui chat/ 나머지 | chat |
| C | ui canvas/, views/, book/, notes/ | canvas, views, book, notes |
| D | ui session/, vault/, skills/, prompts/, app/, components/, search/, window/, persist/, lib/ | session, vault, skills, prompts, app, components |
| E1 | core prompts, context, study, skills, skillAssist, skill-match, seed, providers/mock, quiz, branch-suggest, pageAssist, book, speak-block | llm, skillsBuiltin, seed, demo |
| E2 | core 나머지(store, sync, bridge/, backup/, providers/(mock 제외), model, canvas, page*, vault, tts, stt, anchor 등) | core, errors, sync |
| E3 | packages/bridge, packages/relay, apps/desktop/src(main 언어 IPC 제외 — 리더 완료), apps/mobile/src, apps/server | bridge, cli, desktop, mobile |

리더만: common.json, locales/*/index.ts, i18n/index.ts, ui/src/i18n/*, LanguageField, App.tsx 언어 창 연결, playwright.config.ts, 문서.

## 추출 규칙 (모든 담당 공통)
1. **ko 값은 원문과 글자 하나까지 같게** 옮긴다 (e2e·단위 테스트가 한국어 문구로 찾는다).
2. en은 자연스러운 앱 영어로 번역. 키·`{자리표시자}` 동일. 단수형이 필요하면 `<키>_one`.
3. 키는 camelCase, 화면/컴포넌트별로 중첩 (`settings.general.defaultProvider`).
4. `t()`는 렌더·호출 시점에 부른다. 모듈 최상단 상수의 문구는 키로 바꾸거나 함수로 감싼다.
5. 문자열 결합 대신 자리표시자 (`t('x.count', { count })`). JSX 안 강조 등은 `tx()`.
6. 날짜·숫자 포맷은 `intlLocale()`.
7. 주석·로그(개발자용 console)·테스트 픽스처·내부 식별자는 옮기지 않는다. 사용자에게 보이거나 LLM에 보내는 문구만.
8. 자기 파일과 자기 이름공간 JSON만 고친다.

## 검증
- 담당: `npx tsc -p <패키지> --noEmit`(다른 담당의 진행 중 오류는 무시), 관련 vitest.
- 리더: 통합 후 전체 검증, 독립 리뷰, e2e, 데스크톱 패키징·실행 확인.
