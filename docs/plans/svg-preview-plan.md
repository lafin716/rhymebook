# 세션 SVG 이미지 출력

- 목표: 기존 답변의 완성된 SVG 코드 블록과 단독 SVG를 이미지로 표시하고 원본은 펼쳐 볼 수 있게 한다.
- 범위/소유권: lead가 UI Markdown 렌더러·SVG 컴포넌트·선택 처리·스타일·관련 검증을 수정. 기존 저장 데이터·provider·동기화 계약은 유지.
- 계약: SVG 원문/offset을 바꾸지 않음. img 데이터 URL로 렌더. 미완성/깨진 SVG는 코드로 표시. 미리보기의 UI 텍스트는 가지 선택 offset에서 제외.
- 순서: 원문 감지 → 미리보기 컴포넌트 → 단위/E2E·타입/린트 → 독립 리뷰 → 데스크톱 패키징·격리 앱 smoke.
- 난이도 MEDIUM, 목표 STANDARD/medium. 현재 모델/effort는 상속(정확한 실행값 unknown), 구현은 직접 수행.
- 검증: SVG/XML/언어 없는 코드·raw SVG·한국어/특수문자·미완성/잘못된 XML·일반 코드 회귀·SVG 뒤 가지 선택. 390/1440 스크린샷과 코드 펼침. Windows package:dir 및 격리 userData 앱 smoke. 외부 배포는 로컬 UI 변경의 범위에 해당하지 않음.

## 결과 (2026-10-14)

- 구현 완료, 독립 리뷰에서 발견한 raw SVG 빈 줄·수식 구분자·앞 코드 블록 간섭을 수정하고 회귀 검증 완료.
- 전체 `pnpm typecheck`, 변경 파일 eslint, `git diff --check` 통과. UI 47/47, SVG 브라우저 E2E 4/4(390/1440) 통과. 기존 수식·앵커 테스트 통과.
- Windows 기본 패키징은 실행 중 기존 앱의 app.asar 잠금으로 EBUSY. 대안으로 `pnpm --filter @branch/desktop build` 후 `pnpm --filter @branch/desktop exec electron-builder --dir --publish never --config.directories.output=release/svg-preview` 성공.
- 새 앱: `apps/desktop/release/svg-preview/win-unpacked/rhymebook.exe`. 임시 userData로 실제 패키지 실행·SVG 로드·코드 펼침·잘못된 XML 복귀 smoke 1/1 성공. 처음의 smoke 실패는 준비된 CLI가 있으면 안내가 생략되는 동작을 테스트가 가정하지 못했기 때문이며, 설정 화면에서 모의 API를 지정하는 테스트로 수정.
- 실제 앱과 웹/모바일 스크린샷을 직접 확인. 기존 실행 앱은 종료하지 않았고 새 빌드는 사용자가 앱 종료 후 실행할 수 있음. 사용자 데이터·외부 서비스 변경 없음.
