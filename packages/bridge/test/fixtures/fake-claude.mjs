#!/usr/bin/env node
// 테스트용 가짜 claude CLI. FAKE_MODE: ok | echo | logged-out | crash | slow
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
