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
  // 첨부가 있으면 content는 블록 배열 (이미지·문서 + 텍스트)
  const blocks = Array.isArray(last?.content) ? last.content : [];
  const raw = typeof last?.content === 'string' ? last.content : (blocks.find((b) => b.type === 'text')?.text ?? '');
  const texts = (raw.match(/<attachment name="/g) ?? []).length;
  const content = raw.replace(/<attachment[\s\S]*?<\/attachment>\s*/g, '');
  const images = blocks.filter((b) => b.type === 'image').length;
  const skill = system.match(/## 스킬: .+ \(\/([^)]+)\)/)?.[1];
  const extras = [
    images ? `이미지 ${images}개를 받았다.` : '',
    texts ? `첨부 텍스트 ${texts}개를 읽었다.` : '',
    skill ? `스킬 /${skill} 적용.` : '',
  ].filter(Boolean);
  if (system.startsWith('다음 대화의 주제')) return '어텐션 학습';
  if (system.startsWith('다음은 학습자가')) {
    const topic = content.match(/질문 대상: "([^"]+)"/)?.[1] ?? '?';
    return `요약[${topic}]: 쿼리와 키의 유사도로 값을 섞는다는 점을 이해했다.`;
  }
  if (system.startsWith('너는 학습 채팅앱의 "스킬" 작성 도우미')) {
    // 새 스킬: 요청을 지시에 담는다. 고치기: 기존 이름·제목은 두고 지시 끝에 요청을 더한다
    const ask = content.match(/## 요청\n([\s\S]*)$/)?.[1]?.trim() ?? '';
    const cur = content.match(/<prompt>\n([\s\S]*?)\n<\/prompt>/)?.[1];
    const name = content.match(/<name>([^<]*)<\/name>/)?.[1] || 'vocab';
    const title = content.match(/<title>([^<]*)<\/title>/)?.[1] || '단어 암기';
    return [
      '```',
      `<name>${name}</name>`,
      `<title>${title}</title>`,
      '<description>AI가 만든 스킬</description>',
      '<prompt>',
      cur ? `${cur}\n추가: ${ask}` : `요청: ${ask}`,
      '</prompt>',
      `<note>${cur ? '요청을 지시에 더했어요.' : '새 스킬을 만들었어요.'}</note>`,
      '```',
    ].join('\n');
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
    ...(extras.length ? [extras.join(' '), ''] : []),
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
