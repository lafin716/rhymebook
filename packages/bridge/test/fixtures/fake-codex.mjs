#!/usr/bin/env node
// 테스트용 가짜 codex CLI. FAKE_MODE: ok | echo | logged-out | failed
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'ok';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (args[0] === '--version') {
  console.log('codex-cli 9.9.9');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  if (mode === 'logged-out') {
    console.error('Not logged in');
    process.exit(1);
  }
  console.error('Logged in using an API key - sk-proj-abcdefghijklmnop');
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  out({ type: 'thread.started', thread_id: 't1' });
  out({ type: 'turn.started' });
  if (mode === 'failed' || mode === 'logged-out') {
    const msg = mode === 'failed' ? '{"type":"error","error":{"type":"invalid_request_error","message":"model is not supported"},"status":400}' : 'unexpected status 401 Unauthorized';
    out({ type: 'item.completed', item: { id: 'w', type: 'error', message: 'warning: something' } });
    out({ type: 'error', message: msg });
    out({ type: 'turn.failed', error: { message: msg } });
    process.exit(1);
  }
  if (mode === 'echo') {
    out({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: JSON.stringify({ args, stdin }) } });
  } else {
    out({ type: 'item.updated', item: { id: 'i0', type: 'agent_message', text: '첫 ' } });
    out({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: '첫 문단' } });
    out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '둘째' } });
  }
  out({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
});
