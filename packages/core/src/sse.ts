/** Server-Sent Events 파서 (순수 함수 + 스트림 어댑터). 플랫폼 무관. */

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * 누적 버퍼에서 완결된 이벤트만 꺼낸다. 남은(미완결) 텍스트는 rest로 돌려준다.
 * 이벤트 구분: 빈 줄. CRLF/CR도 허용. 주석(`:`)은 무시.
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const events: SseEvent[] = [];
  let start = 0;
  for (;;) {
    const end = normalized.indexOf('\n\n', start);
    if (end < 0) break;
    const block = normalized.slice(start, end);
    start = end + 2;
    const ev = parseBlock(block);
    if (ev) events.push(ev);
  }
  return { events, rest: normalized.slice(start) };
}

function parseBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length && !event) return null;
  return event === undefined ? { data: data.join('\n') } : { event, data: data.join('\n') };
}

/** fetch Response body → SSE 이벤트 비동기 반복자 */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      yield* events;
    }
    buffer += decoder.decode();
    const { events } = parseSseChunk(buffer + '\n\n');
    yield* events;
  } finally {
    reader.releaseLock();
  }
}
