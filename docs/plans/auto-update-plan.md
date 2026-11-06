# 데스크톱 앱 자동 업데이트 (ADR-118)

- 목표: GitHub 사이트에 가지 않고 앱 안에서 새 버전 확인 → 알림 → 다운로드 → 재시작하여 설치까지 한다.
- 범위: Electron main(updater 상태 기계·IPC·preload), core 순수 로직(상태 전이·버전 비교·오류 분류·모드 결정), UI(알림 카드·설정 › 일반 › 앱 업데이트), release.yml(메타데이터 업로드·태그 검증), 문서.
- 유지할 것: GitHub Releases 배포(서버·DB 없음), 기존 설치 파일 이름·플랫폼, appId `app.branchlearn.desktop`, 사용자 데이터 폴더 `<appData>/rhymebook`, 수동 설치 경로.
- 난이도 HIGH(배포·보안·데이터 보존), 목표 ADVANCED/high. 현재 모델 상속, 구현은 리더 직접, 독립 리뷰는 별도 에이전트.

## 분석 결과

- 빌드: 이미 electron-builder 26 (mac dmg/zip, win nsis/portable, linux AppImage/deb). 전환 불필요.
- 배포: release.yml이 태그 `v*`에서 3개 OS 빌드 후 초안 Release에 첨부. `latest*.yml`·blockmap은 올리지 않고 있었음.
- 서명: macOS·Windows 미서명(B-03). macOS 자동 설치(Squirrel.Mac)는 서명된 앱만 가능.

## 계약

- 상태: `idle | checking | available | downloading | downloaded | installing | error`, `UpdateState { status, mode, modeReason?, currentVersion, latestVersion?, releaseNotes?, percent?, transferred?, total?, error?, lastCheckedAt? }`.
- 모드: `auto`(Windows NSIS, Developer ID 서명 macOS, Linux AppImage) · `manual`(미서명 mac, deb, portable 등 — GitHub API로 확인하고 릴리스 페이지를 연다) · `disabled`(개발 실행, `RHYMEBOOK_DISABLE_UPDATE=1`).
- IPC: `update:state|check|download|install|openRelease`(인자 없음), 방송 `update:changed`. preload `branchDesktop.updater`.
- 일정: 실행 10초 뒤, 이후 6시간마다. 수동 확인은 5초 간격 제한. 동시 확인은 하나로 합친다. 받는 중·받은 뒤·설치 중에는 확인하지 않는다.
- 설치: 사용자 동의 후 다운로드(autoDownload=false), electron-updater의 sha512 검증, 사용자가 [재시작하여 설치]를 누를 때만 생성 중 응답 확인 → 로컬 저장 flush → `quitAndInstall`(autoInstallOnAppQuit=false, 받은 파일은 캐시에 남음). 20초 안에 앱이 끝나지 않으면 downloaded로 되돌린다.
- 정식 릴리스만: `allowPrerelease=false`, GitHub `releases/latest`는 초안·prerelease를 돌려주지 않는다. 다운그레이드 금지.

## Task

| ID | 내용 | 의존 |
|---|---|---|
| U1 | core `update.ts` + 단위 테스트 | — |
| U2 | desktop `updater.ts`·ipc·preload·main | U1 |
| U3 | UI 알림 카드·설정 섹션·i18n 5개 언어 | U1 |
| U4 | release.yml(메타데이터·버전 검증), publish 설정 | — |
| U5 | 패키지 앱 e2e(모의 GitHub 응답) | U2·U3 |
| U6 | 독립 리뷰·수정 | U5 |
| U7 | 문서(README·DEVELOPMENT·ADR·BLOCKERS·PROGRESS)·재빌드·커밋 | U6 |

## 검증

- 단위: 상태 전이·버전 비교·prerelease/초안 거부·오류 분류·모드 결정·신뢰 URL.
- 패키지 앱 e2e: 최신(404)·같은 버전·prerelease 무시·500/403 오류·새 버전 알림·변경 사항·릴리스 페이지·나중에·다음 버전 재알림·동시 확인 1회.
- 빌드 산출물: `electron-builder --mac zip --publish never`로 `latest-mac.yml`·blockmap·`app-update.yml` 생성 확인.
- 로컬에서 불가: 실제 설치·재실행(서명된 빌드와 실제 릴리스 필요) → B-17~B-20.
