import { describe, expect, it } from 'vitest';
import { buildSegmentMap, locateAnchor, selectionToAnchor, sourceToRender, type RenderTextNode } from '../src/anchor';
import { createSeed } from '../src/seed';

/**
 * 테스트용 미니 렌더러: **굵게**, `코드`, *기울임* 기호를 지우고, 남은 텍스트 노드에 원문 위치(hint)를 붙인다.
 * react-markdown이 position을 넘겨주는 방식과 같은 형태.
 */
function render(source: string): RenderTextNode[] {
  const nodes: RenderTextNode[] = [];
  const re = /\*\*([\s\S]+?)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  const push = (start: number, end: number) => {
    if (end > start) nodes.push({ value: source.slice(start, end), hint: { start, end } });
  };
  for (let m = re.exec(source); m; m = re.exec(source)) {
    push(last, m.index);
    const inner = m[1] ?? m[2] ?? m[3]!;
    const open = m[0].indexOf(inner);
    push(m.index + open, m.index + open + inner.length);
    last = m.index + m[0].length;
  }
  push(last, source.length);
  return nodes;
}

const mapOf = (source: string) => buildSegmentMap(render(source), source);

describe('앵커 복원 — 선택 → 저장 → 다시 렌더 → 복원 왕복', () => {
  const sources = [
    '어텐션은 **Query**와 **Key**의 내적으로 점수를 만들고, `softmax`로 정규화합니다.',
    '같은 단어 반복: 벡터, 벡터, 그리고 *또* 벡터.',
    '줄바꿈이\n포함된 **두 줄\n강조** 문장',
  ];

  for (const source of sources) {
    it(`모든 단어 경계 선택이 같은 렌더 범위로 복원된다: ${source.slice(0, 16)}…`, () => {
      const map = mapOf(source);
      const text = map.renderText;
      const bounds = [0, ...[...text.matchAll(/\s+/g)].flatMap((m) => [m.index, m.index + m[0].length]), text.length];
      for (const rs of bounds) {
        for (const re of bounds) {
          if (re <= rs) continue;
          const a = selectionToAnchor('m', map, rs, re);
          if (!a) continue;
          // 저장된 원문 범위는 같은 텍스트를 감싸고 있어야 한다 (마크다운 기호만 차이)
          expect(source.slice(a.startOffset, a.endOffset).replace(/[*`]/g, '')).toBe(a.text);
          // 같은 원문을 다시 렌더해도 같은 위치로 복원된다 (동일 텍스트가 여러 번 나와도)
          const r = locateAnchor(mapOf(source), a)!;
          expect(text.slice(r.start, r.end)).toBe(a.text);
          expect(r.start).toBe(sourceToRender(map, a.startOffset, 'start'));
        }
      }
    });
  }

  it('메시지 앞부분이 바뀌어 offset이 밀려도 텍스트로 복원한다', () => {
    const before = '스케일링은 **√d_k**로 나눕니다.';
    const a = selectionToAnchor('m', mapOf(before), 6, 10)!;
    expect(a.text).toBe('√d_k');
    const after = `(보충 설명 추가) ${before}`;
    const m = mapOf(after);
    const r = locateAnchor(m, a)!;
    expect(m.renderText.slice(r.start, r.end)).toBe('√d_k');
  });

  it('같은 텍스트가 여러 번이면 저장된 offset에 가장 가까운 출현을 고른다', () => {
    const source = '벡터 A와 **벡터** B, 그리고 벡터 C';
    const map = mapOf(source);
    const second = map.renderText.indexOf('벡터', 1);
    const a = selectionToAnchor('m', map, second, second + 2)!;
    expect(locateAnchor(map, a)).toEqual({ start: second, end: second + 2 });
    const third = map.renderText.lastIndexOf('벡터');
    const a3 = selectionToAnchor('m', map, third, third + 2)!;
    expect(locateAnchor(map, a3)).toEqual({ start: third, end: third + 2 });
  });

  it('강조 표시가 생기거나 공백이 바뀌어도 복원, 텍스트가 사라지면 null', () => {
    const a = selectionToAnchor('m', mapOf('코사인 유사도는 각도를 봅니다'), 0, 7)!;
    expect(a.text).toBe('코사인 유사도');
    const m1 = mapOf('**코사인  유사도**는 각도를 봅니다');
    expect(m1.renderText.slice(...Object.values(locateAnchor(m1, a)!) as [number, number])).toBe('코사인  유사도');
    expect(locateAnchor(mapOf('완전히 다른 답변'), a)).toBeNull();
  });

  it('시드 데이터의 모든 앵커가 원문 범위와 일치하고 렌더 텍스트에서 복원된다', () => {
    const { sessions, messages } = createSeed(0);
    const branches = Object.values(sessions).filter((s) => s.anchor);
    expect(branches.length).toBeGreaterThanOrEqual(4);
    for (const s of branches) {
      const msg = messages[s.parentId!]!.find((m) => m.id === s.anchor!.messageId)!;
      expect(msg, s.id).toBeDefined();
      const raw = msg.content.slice(s.anchor!.startOffset, s.anchor!.endOffset);
      expect(raw.replace(/[*`]/g, ''), s.id).toBe(s.anchor!.text);
      const map = mapOf(msg.content);
      const r = locateAnchor(map, s.anchor!);
      expect(r, s.id).not.toBeNull();
      expect(map.renderText.slice(r!.start, r!.end)).toBe(s.anchor!.text);
    }
  });
});
