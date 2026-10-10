import http from 'node:http';

/**
 * E2E용 모의 Anthropic Messages API (SSE).
 * 응답은 요청 내용으로 결정되므로 테스트를 병렬로 돌려도 안전하다.
 * - 채팅: 마지막 학습자 메시지의 "따옴표 대상"(없으면 앞 12자)을 끝 문장에 넣는다
 * - 요약/제목: system 프롬프트로 구분
 */
const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 8799);
const KEY = 'sk-ant-e2e-ok';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

function reply(body) {
  const system = typeof body.system === 'string' ? body.system : '';
  const last = [...body.messages].reverse().find((m) => m.role === 'user');
  const content = typeof last?.content === 'string' ? last.content : '';
  if (system.startsWith('다음 대화의 주제')) return '어텐션 학습';
  if (system.startsWith('다음은 학습자가')) {
    const topic = content.match(/질문 대상: "([^"]+)"/)?.[1] ?? '?';
    return `요약[${topic}]: 쿼리와 키의 유사도로 값을 섞는다는 점을 이해했다.`;
  }
  const topic = content.match(/"([^"]+)"/)?.[1] ?? content.slice(0, 12);
  const depth = (system.match(/^\d+\. "/gm) ?? []).length;
  return [
    `깊이 ${depth} 응답. **어텐션**은 쿼리와 키의 유사도로 값을 가중합한다.`,
    '',
    '- 스케일링: √d로 나눈다',
    '- 소프트맥스: 가중치를 확률로 만든다',
    '',
    '```python',
    'w = softmax(q @ k.T / d**0.5)',
    '```',
    '',
    `마지막 문장 [${topic}].`,
  ].join('\n');
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.url === '/health') {
      res.writeHead(200, cors);
      return res.end('ok');
    }
    if (req.headers['x-api-key'] !== KEY) {
      res.writeHead(401, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    }
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      return res.end('{"data":[]}');
    }
    let raw = '';
    for await (const c of req) raw += c;
    const text = reply(JSON.parse(raw));
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
    send({ type: 'message_start', message: {} });
    for (const ch of text.match(/.{1,8}/gs)) {
      send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ch } });
      await new Promise((r) => setTimeout(r, 8));
    }
    send({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
    send({ type: 'message_stop' });
    res.end();
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock anthropic on ${PORT}`));
