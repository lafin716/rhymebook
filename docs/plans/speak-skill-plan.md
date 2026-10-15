# 음성으로 읽기 스킬 · 읽기 카드 · 요청 맞춤 스킬 자동 사용 (IMP-21)

- 목표: (1) 기본 스킬 `/speak` 추가, (2) 답변 속 ```speak 블록을 대화창 재생 카드로(줄마다 듣기·모두 듣기), (3) 슬래시 없이 보낸 질문이 스킬 용도와 맞으면 그 스킬을 자동으로 쓴다.
- 모드: Scoped feature. 난이도 MEDIUM, 모델 inherit(현재 Claude), effort default. lead 직접 구현 + 독립 reviewer 서브에이전트.
- 유지할 동작: 기존 스킬 모델(`SkillRef` 키 고정, 동기화 검증), 퀴즈 카드, 선택 메뉴 [듣기], 기존 사용자의 기본 스킬 seed 규칙(id 기준, 지운 기본 스킬은 되살리지 않음), 앵커 오프셋.
- 계약:
  - core `speak-block.ts`: `parseSpeakBlock(source) → {title, items:[{text, lang, note?}]} | null` (JSON·배열·한 줄씩 텍스트 허용, 제한 50줄).
  - core `skill-match.ts`: `matchSkill(text, skills) → Skill | null` — 결정적 규칙(기본 스킬 의도 표현 > 제목·이름 언급), 슬래시 명령·짧은 글은 null. AI 추가 호출 없음.
  - ui `voice/speak.ts`: `speak(text, {lang, key})`, `speakAll(lines)`, `stopSpeaking()`; `useSpeech` = `{status, key}`. 재생 id(seq)로 이전 콜백이 큐를 넘기지 않게.
  - ui 설정 `branch.autoSkill`(기기별, 기본 켜짐).
- 순서: core(블록·매칭·스킬·mock) + 테스트 → ui(큐·카드·입력창 자동 칩·설정) → e2e → 독립 리뷰 → 데스크톱 패키지 앱 확인 → 문서·커밋.
- 검증: `pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e`(speak.spec desktop·mobile), 패키지 데스크톱 앱 실행.
