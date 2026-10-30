import { describe, expect, it } from 'vitest';
import {
  extractBranchSuggestions,
  guessChapters,
  locateChapters,
  parseBranchBlock,
  planBranchSuggestions,
  stripBranchBlock,
} from '../src/branch-suggest';
import { buildChatRequest, toTurns } from '../src/context';
import type { Message } from '../src/model';

const CURRICULUM = `# 선형대수 4주 로드맵

## 1주차: 벡터와 내적
벡터의 뜻을 익혀요.

## 2주차: **행렬** 곱셈
- 행렬 곱 연습

\`\`\`python
## 1주차: 벡터와 내적
\`\`\`

## 3주차: 고유값

\`\`\`branches
{"chapters":[{"title":"1주차: 벡터와 내적","question":"벡터와 내적을 배우자"},{"title":"2주차: 행렬 곱셈","question":"행렬 곱셈을 배우자"},{"title":"3주차: 고유값","question":"고유값을 배우자"},{"title":"5주차: 없음","question":"없는 챕터"}],"next":[{"title":"선형대수 왜 필요?","question":"선형대수가 머신러닝에 왜 필요해?"}]}
\`\`\``;

describe('branch suggestions (ADR-094)', () => {
  it('parses blocks leniently', () => {
    expect(parseBranchBlock('{"chapters":[],"next":[{"title":"a","question":"질문 a"},"질문 b"]}')).toEqual({
      chapters: [],
      next: [
        { title: 'a', question: '질문 a' },
        { title: '질문 b', question: '질문 b' },
      ],
    });
    expect(parseBranchBlock('- 첫 질문\n2. 둘째 질문').next.map((s) => s.question)).toEqual(['첫 질문', '둘째 질문']);
    expect(parseBranchBlock('{"next":[{"title":"x"}, null, 3]}').next).toEqual([{ title: 'x', question: 'x' }]);
    expect(parseBranchBlock('').next).toEqual([]);
    expect(parseBranchBlock(JSON.stringify({ next: ['a', 'b', 'c', 'd', 'e', 'f'] })).next).toHaveLength(4);
  });

  it('extracts and strips the block, including a half-streamed one', () => {
    expect(extractBranchSuggestions(CURRICULUM)?.chapters).toHaveLength(4);
    expect(extractBranchSuggestions('그냥 답')).toBeNull();
    const stripped = stripBranchBlock(CURRICULUM);
    expect(stripped).not.toContain('branches');
    expect(stripped.endsWith('## 3주차: 고유값')).toBe(true);
    expect(stripBranchBlock('답변\n\n```branches\n{"next":[')).toBe('답변');
    expect(stripBranchBlock('답변')).toBe('답변');
  });

  it('locates chapters on heading lines outside code fences', () => {
    const { located, missing } = locateChapters(CURRICULUM, extractBranchSuggestions(CURRICULUM)!.chapters);
    expect(located.map((c) => c.anchor.text)).toEqual(['1주차: 벡터와 내적', '2주차: 행렬 곱셈', '3주차: 고유값']);
    expect(missing.map((c) => c.title)).toEqual(['5주차: 없음']);
    const first = located[0]!;
    expect(CURRICULUM.slice(first.anchor.startOffset, first.anchor.endOffset)).toBe('1주차: 벡터와 내적');
    expect(CURRICULUM.slice(first.lineStart).startsWith('## 1주차')).toBe(true);
    // 강조 기호가 섞이면 원문 범위는 기호까지
    expect(CURRICULUM.slice(located[1]!.anchor.startOffset, located[1]!.anchor.endOffset)).toBe('2주차: **행렬** 곱셈');
  });

  it('matches list items and prefix titles', () => {
    const md = '1. **Step 1 — 환경 설치** (30분)\n2. Step 2 — 첫 코드';
    const { located } = locateChapters(md, [
      { title: 'Step 1 환경 설치', question: 'q1' },
      { title: 'Step 2 — 첫 코드 작성하기', question: 'q2' },
    ]);
    expect(located.map((c) => c.question)).toEqual(['q1', 'q2']);
    expect(located[1]!.anchor.text).toBe('Step 2 — 첫 코드');
  });

  it('guesses chapters from numbered headings when there is no block', () => {
    expect(guessChapters('## 1단계 준비\n## 2단계 실습\n## 정리').map((c) => c.title)).toEqual(['1단계 준비', '2단계 실습']);
    expect(guessChapters('## Week 1\n## week 2')).toHaveLength(2);
    expect(guessChapters('## 1단계 준비\n본문')).toEqual([]);
    expect(guessChapters('- 1단계\n- 2단계')).toEqual([]);
  });

  it('plans chapters and next chips per message', () => {
    const plan = planBranchSuggestions(CURRICULUM);
    expect(plan.chapters).toHaveLength(3);
    expect(plan.next.map((s) => s.question)).toEqual(['없는 챕터', '선형대수가 머신러닝에 왜 필요해?']);
    expect(planBranchSuggestions('## 1장 소개\n## 2장 본론').chapters).toHaveLength(2);
    expect(planBranchSuggestions('평범한 답')).toEqual({ chapters: [], next: [] });
  });

  it('keeps the block out of model context but asks for it in chat', () => {
    const msg: Message = { id: 'm', sessionId: 's', role: 'assistant', content: CURRICULUM, createdAt: 0 } as Message;
    expect(toTurns([msg])[0]!.content).not.toContain('```branches');
    const req = buildChatRequest({ sessionId: 's', sessions: {}, messages: { s: [msg] } } as never);
    expect(req.system).toContain('```branches');
  });
});

describe('책 목차 커리큘럼: 큰 챕터에만 가지 버튼', () => {
  const TOC = `# 파이썬 입문

## 1장. 기초 문법
_목표: 변수와 자료형 · 약 3시간_

1. **1.1 변수** — 값을 이름에 담는다
2. **1.2 자료형** — 숫자·문자열을 구분한다

## 2장. 함수
1. **2.1 함수 정의** — 코드를 묶는다

## 다음으로
- 비동기`;

  it('하위 챕터까지 적혀 와도 큰 챕터(## 줄)만 남기고, 하위 챕터는 칩으로도 내리지 않는다', () => {
    const block = {
      chapters: [
        { title: '1장. 기초 문법', question: '기초 문법' },
        { title: '1.1 변수', question: '변수' },
        { title: '1.2 자료형', question: '자료형' },
        { title: '2장. 함수', question: '함수' },
      ],
      next: [{ title: '비동기', question: '비동기를 알려줘' }],
    };
    const plan = planBranchSuggestions(`${TOC}\n\n\`\`\`branches\n${JSON.stringify(block)}\n\`\`\``);
    expect(plan.chapters.map((c) => c.question)).toEqual(['기초 문법', '함수']);
    expect(plan.next.map((c) => c.question)).toEqual(['비동기를 알려줘']);
  });

  it('목록 줄 챕터만 있으면 그대로 둔다', () => {
    const content = '1. **변수와 자료형** — 값\n2. **함수와 모듈** — 묶음\n\n```branches\n{"chapters":[{"title":"변수와 자료형","question":"q1"},{"title":"함수와 모듈","question":"q2"}],"next":[]}\n```';
    expect(planBranchSuggestions(content).chapters.map((c) => c.question)).toEqual(['q1', 'q2']);
  });
});
