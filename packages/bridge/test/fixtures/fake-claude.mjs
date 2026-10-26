#!/usr/bin/env node
// 테스트용 가짜 claude CLI. FAKE_MODE: ok | echo | logged-out | crash | slow | tools
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'ok';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (mode === 'logged-out') {
    console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.com' }));
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', async () => {
  out({ type: 'system', subtype: 'init' });
  if (mode === 'logged-out') {
    out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    return;
  }
  if (mode === 'crash') {
    process.stderr.write('boom: something failed\n');
    process.exit(2);
  }
  const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  if (mode === 'echo') {
    const i = args.indexOf('--system-prompt-file');
    const system = readFileSync(args[i + 1], 'utf8');
    delta(JSON.stringify({ args, system, stdin, cwd: process.cwd() }));
  } else if (mode === 'tools') {
    // 실제 stream-json 형식 (--tools에 WebSearch가 있을 때만 도구를 쓴다)
    const web = args[args.indexOf('--tools') + 1] === 'WebSearch,WebFetch';
    delta('찾아볼게요.');
    if (web) {
      const use = { type: 'tool_use', id: 'toolu_1', name: 'WebSearch', input: { query: '서울 날씨' } };
      out({ type: 'assistant', message: { model: 'claude', content: [use] } });
      out({
        type: 'user',
        message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: '...' }] },
        tool_use_result: { query: '서울 날씨', results: [{ tool_use_id: 'srvtoolu_1', content: [{ title: '기상청', url: 'https://www.weather.go.kr/' }] }] },
      });
      out({ type: 'stream_event', event: { type: 'message_start' } });
    }
    delta('맑아요.');
  } else if (mode === 'slow') {
    delta('천천히 ');
    await new Promise((r) => setTimeout(r, 30_000));
  } else {
    delta('안녕');
    delta('하세요');
    out({ type: 'assistant', message: { model: 'claude', content: [{ type: 'text', text: '안녕하세요' }] } });
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: '안녕하세요', stop_reason: 'end_turn' });
});
