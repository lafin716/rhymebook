# 이해 노트 개편: 학습 꾸러미 내보내기·가져오기 + 책으로 만들기 (ADR-043)

모드: Scoped feature (core·ui·sync·server 걸침, 계약이 하나라 리더가 직접 구현 + 스킬 부분 1개 위임, 독립 리뷰 1회).
난이도: MEDIUM~HIGH. 실행 모델은 현재 세션 모델(Opus 5.5) 상속, 서브에이전트도 상속.

## 목표 (관찰 가능한 완료 기준)
1. 이해 노트에서 [학습 내보내기] → `<제목>-학습-YYYY-MM-DD.zip` 저장. 안에 `<제목>/README.md`(목차·가져오는 법),
   세션마다 Markdown 한 개(`00 루트.md`, `01 가지.md`, `01.02 하위.md` …, 대화·앵커·요약·하위 가지 링크), `study.json`(가져오기 원본).
2. 다른 기기에서 [학습 가져오기]로 그 zip(또는 study.json)을 고르면 세션 트리·메시지·어노테이션이 들어온다.
   - 같은 학습(같은 id)이면 세션별로 더 최근에 바뀐 쪽을 남긴다(이어서 학습). 이 기기에만 있는 가지는 그대로.
   - 생성 중인 세션은 건드리지 않는다.
   - 데스크톱: 로컬 스토어에 바로. 웹·모바일(원격 전용): 새 sync op `study.import`로 PC에 보낸다(6MB 한도).
3. 이해 노트 [책으로 만들기] → 새 루트 세션 "📖 <제목>"을 만들고, 학습 원문(트리 순서 전체 대화·앵커·요약)을 텍스트 첨부로,
   내장 스킬 `/book`(책으로 만들기)을 붙여 보낸다. 스킬은 구조 분석 → 목차 → 장별 본문 순서로 책을 쓴다.
4. `/book` 내장 스킬: 기존 사용자에게도 한 번 들어간다(시드 기록을 id 목록으로 확장). 헤드리스 serve도 같다.

## 유지할 동작
- 기존 [Markdown 저장]·[Anki 카드]·[복사], 카드 목록, 백업 JSON(설정 › 백업) 그대로.
- 지운 내장 스킬은 다시 넣지 않는다(이미 시드한 id는 건너뜀).

## 공통 계약 (core)
- `packages/core/src/study.ts`
  - `STUDY_APP = 'rhymebook-study'`, `STUDY_VERSION = 1`
  - `interface StudyBundle { app; version; exportedAt; rootId; title; sessions: Session[]; messages: Message[]; annotations: Annotation[] }`
  - `collectStudy(state, rootId, now)` → StudyBundle
  - `studyPackFiles(bundle)` → `{ path, content }[]` (README·세션 md·study.json)
  - `buildStudyPack(bundle)` → Uint8Array (zip, fflate)
  - `readStudyPack(bytes | text)` → StudyBundle (zip이면 `study.json`을 찾고, JSON이면 바로) — 검증 실패 시 `StudyError`
  - `planStudyImport(local, bundle, busy)` → 세션별 add/update/keep 계획 + 결과 수
  - `buildStudyDigest(bundle, maxChars)` → 책 만들기용 학습 원문 Markdown(길면 답변을 비례로 줄임)
- 스토어: `importStudy(bundle): StudyImportResult | false`. 원격 클라이언트는 `study.import` act로 대체.
- 동기화: `SyncOp { kind: 'study.import'; bundle: StudyBundle }` — 클라이언트·호스트 양쪽 검증(트리 일관성, id 형식, 크기).

## 소유권
- 리더: core study.ts·store·sync(bridge/sync.ts·host.ts·client.ts)·ui NotesModal·download·문서.
- 서브에이전트(executor): core skills.ts(`BOOK_SKILL_ID`, 스킬 정의)·ui skillsStore.ts 시드 이전·server engine.ts 시드·관련 테스트.
- 리뷰어(별도 agent): 전체 diff 리뷰.

## 검증
- `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`
- core 단위: 꾸러미 왕복(zip → read → 같은 데이터), 검증 실패, 합치기 계획(추가·최근 우선·생성 중 보존), digest 축약.
- sync: 호스트 `study.import` 실행·거부.
- UI: 데스크톱 앱 재빌드·실행, 이해 노트 모달 스크린샷(모바일·데스크톱 폭).
