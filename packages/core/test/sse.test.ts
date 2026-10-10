import { describe, expect, it } from 'vitest';
import { parseSseChunk, readSse } from '../src/sse';

describe('parseSseChunk', () => {
  it('완결된 이벤트만 꺼내고 나머지는 rest로 남긴다', () => {
    const { events, rest } = parseSseChunk('event: a\ndata: 1\n\ndata: 2\n\ndata: 3');
    expect(events).toEqual([{ event: 'a', data: '1' }, { data: '2' }]);
    expect(rest).toBe('data: 3');
  });

  it('CRLF, 주석, 여러 줄 data를 처리한다', () => {
    const { events } = parseSseChunk(': ping\r\ndata: x\r\ndata: y\r\n\r\n');
    expect(events).toEqual([{ data: 'x\ny' }]);
  });

  it('콜론 뒤 공백 하나만 제거한다', () => {
    expect(parseSseChunk('data:  two\n\n').events[0]!.data).toBe(' two');
  });
});

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

describe('readSse', () => {
  it('청크 경계가 이벤트 중간에 걸려도 복원한다', async () => {
    const out: string[] = [];
    for await (const ev of readSse(streamOf(['da', 'ta: 한', '글\n', '\ndata: [DONE]']))) out.push(ev.data);
    expect(out).toEqual(['한글', '[DONE]']);
  });
});
