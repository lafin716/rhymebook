import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createBridgeClient,
  type BridgeServerMsg,
  type BridgeTransport,
  type StreamEvent,
} from '@branch/core';
import { claudeArgs, classifyCliError, cliModelOptions, codexArgs, winQuote, createBridgeServer, sanitize, type CliEnv } from '../src';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = path.join(dir, 'fixtures/fake-claude.mjs');
const fakeCodex = path.join(dir, 'fixtures/fake-codex.mjs');

function env(mode: string, bins: Partial<CliEnv['bin']> = {}): CliEnv {
  return {
    env: { ...process.env, FAKE_MODE: mode },
    bin: { 'claude-cli': fakeClaude, 'codex-cli': fakeCodex, ...bins },
  };
}

/** 같은 프로세스 안에서 서버와 클라이언트를 잇는 전송로 */
function localTransport(mode: string, bins?: Partial<CliEnv['bin']>): BridgeTransport {
  const server = createBridgeServer({ cliEnv: env(mode, bins) });
  const listeners = new Set<(m: BridgeServerMsg) => void>();
  const conn = server.connect((m) => listeners.forEach((l) => l(m)));
  return {
    send: (m) => conn.receive(m),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const text = (evs: StreamEvent[]) => evs.map((e) => (e.type === 'delta' ? e.text : '')).join('');

const req = { system: '튜터 지시', messages: [{ role: 'user' as const, content: '질문' }] };

describe('bridge server — claude', () => {
  it('부분 델타를 스트리밍하고 완성 메시지는 중복으로 내보내지 않는다', async () => {
    const client = createBridgeClient(localTransport('ok'));
    const evs = await collect(client.stream('claude-cli', req));
    expect(text(evs)).toBe('안녕하세요');
    expect(evs.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('무상태 실행 인자, system 파일, stdin 프롬프트, 임시 작업 디렉터리', async () => {
    const client = createBridgeClient(localTransport('echo'));
    const evs = await collect(
      client.stream('claude-cli', {
        system: '맥락 지시',
        model: 'sonnet',
        messages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
          { role: 'user', content: 'Q2' },
        ],
      }),
    );
    const echo = JSON.parse(text(evs)) as { args: string[]; system: string; stdin: string; cwd: string };
    expect(echo.args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config', '--include-partial-messages']));
    expect(echo.args[echo.args.indexOf('--tools') + 1]).toBe('');
    expect(echo.args[echo.args.indexOf('--model') + 1]).toBe('sonnet');
    expect(echo.args).not.toContain('--effort');
    expect(echo.args).not.toContain('--resume');
    expect(echo.system).toBe('맥락 지시');
    expect(echo.stdin).toContain('[학습자]\nQ1');
    expect(echo.stdin.endsWith('Q2')).toBe(true);
    expect(echo.cwd).toContain('branch-bridge-');
  });

  it('미로그인 → auth 오류(재시도 불가)', async () => {
    const client = createBridgeClient(localTransport('logged-out'));
    const evs = await collect(client.stream('claude-cli', req));
    const last = evs.at(-1)!;
    expect(last.type).toBe('error');
    if (last.type === 'error') {
      expect(last.error.code).toBe('auth');
      expect(last.error.retryable).toBe(false);
      expect(last.error.message).toContain('claude auth login');
    }
  });

  it('비정상 종료 → stderr를 담은 cli 오류', async () => {
    const client = createBridgeClient(localTransport('crash'));
    const last = (await collect(client.stream('claude-cli', req))).at(-1)!;
    expect(last.type === 'error' && last.error.code).toBe('cli');
    expect(last.type === 'error' && last.error.message).toContain('boom');
  });

  it('중지하면 프로세스를 멈추고 aborted로 끝난다', async () => {
    const client = createBridgeClient(localTransport('slow'));
    const ac = new AbortController();
    const evs: StreamEvent[] = [];
    const t0 = Date.now();
    for await (const ev of client.stream('claude-cli', { ...req, signal: ac.signal })) {
      evs.push(ev);
      if (ev.type === 'delta') ac.abort();
    }
    expect(evs[0]).toEqual({ type: 'delta', text: '천천히 ' });
    expect(evs.at(-1)?.type === 'error' && evs.at(-1)).toMatchObject({ error: { code: 'aborted' } });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('실행 파일이 없으면 설치 안내', async () => {
    const client = createBridgeClient(localTransport('ok', { 'claude-cli': '/nonexistent/claude' }));
    const last = (await collect(client.stream('claude-cli', req))).at(-1)!;
    expect(last.type === 'error' && last.error.message).toContain('설치되어 있지 않거나');
  });
});

describe('모델·노력치 인자', () => {
  it('claude는 --effort, 형식이 틀린 값은 버린다', async () => {
    const client = createBridgeClient(localTransport('echo'));
    const ok = JSON.parse(text(await collect(client.stream('claude-cli', { ...req, model: 'opus', effort: 'high' })))) as { args: string[] };
    expect(ok.args[ok.args.indexOf('--model') + 1]).toBe('opus');
    expect(ok.args[ok.args.indexOf('--effort') + 1]).toBe('high');
    const bad = JSON.parse(
      text(await collect(client.stream('claude-cli', { ...req, model: '--dangerously-skip-permissions', effort: 'ultra' }))),
    ) as { args: string[] };
    expect(bad.args).not.toContain('--model');
    expect(bad.args).not.toContain('--effort');
    expect(bad.args).not.toContain('--dangerously-skip-permissions');
  });

  it('codex는 -m과 -c model_reasoning_effort, 프롬프트 표시(-)는 마지막', async () => {
    const client = createBridgeClient(localTransport('echo'));
    const echo = JSON.parse(text(await collect(client.stream('codex-cli', { ...req, model: 'gpt-6-sol', effort: 'ultra' })))) as { args: string[] };
    expect(echo.args[echo.args.indexOf('-m') + 1]).toBe('gpt-6-sol');
    expect(echo.args).toContain('model_reasoning_effort=ultra');
    expect(echo.args.at(-1)).toBe('-');
    expect(codexArgs({}).some((a) => a.startsWith('model_reasoning_effort'))).toBe(false);
  });

  it('codex는 셸·플러그인 등 에이전트 도구를 끈다(-c features.*, 따옴표 없는 값)', () => {
    const args = codexArgs({ effort: 'low' });
    for (const f of ['shell_tool', 'unified_exec', 'apps', 'plugins']) expect(args).toContain(`features.${f}=false`);
    expect(args).toContain('web_search=disabled');
    expect(args).not.toContain('--disable');
    expect(args.some((a) => a.includes('"'))).toBe(false);
  });

  it('win32 cmd 인자: 빈 문자열은 ""로 남고, 공백·메타문자는 따옴표로 감싼다', () => {
    expect(winQuote('')).toBe('""');
    expect(winQuote('--tools')).toBe('--tools');
    expect(winQuote('C:\\Users\\Kim Lee\\sys.txt')).toBe('"C:\\Users\\Kim Lee\\sys.txt"');
    expect(winQuote('a&b')).toBe('"a&b"');
    // claude의 빈 값 인자(--tools '', --setting-sources '')가 cmd에서 사라지지 않는다
    expect(claudeArgs({ systemFile: 's.txt' }).map(winQuote).filter((a) => a === '""')).toHaveLength(2);
  });

  it('모델이 지원하지 않는 노력치는 빼고 CLI 기본을 쓴다', () => {
    expect(cliModelOptions({ providerId: 'codex-cli', model: 'gpt-6-luna', effort: 'ultra' })).toEqual({ model: 'gpt-6-luna' });
    expect(cliModelOptions({ providerId: 'codex-cli', effort: 'x"; rm' })).toEqual({});
    expect(cliModelOptions({ providerId: 'claude-cli', model: 'opus[1m]', effort: 'max' })).toEqual({ model: 'opus[1m]', effort: 'max' });
  });
});

describe('bridge server — codex', () => {
  it('agent_message 항목을 증분으로 내보내고 항목 사이를 문단으로 나눈다', async () => {
    const client = createBridgeClient(localTransport('ok'));
    const evs = await collect(client.stream('codex-cli', req));
    expect(evs.filter((e) => e.type === 'delta').map((e) => (e.type === 'delta' ? e.text : ''))).toEqual(['첫 ', '문단', '\n\n둘째']);
    expect(evs.at(-1)?.type).toBe('done');
  });

  it('읽기 전용 샌드박스·임시 세션·사용자 설정 무시, 지시는 프롬프트 앞에', async () => {
    const client = createBridgeClient(localTransport('echo'));
    const echo = JSON.parse(text(await collect(client.stream('codex-cli', req)))) as { args: string[]; stdin: string };
    expect(echo.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(echo.args[echo.args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(echo.args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-user-config', '--skip-git-repo-check']));
    expect(echo.args.at(-1)).toBe('-');
    expect(echo.stdin).toBe('<instructions>\n튜터 지시\n</instructions>\n\n질문');
  });

  it('turn.failed의 JSON 메시지를 풀어 분류한다', async () => {
    const client = createBridgeClient(localTransport('failed'));
    const last = (await collect(client.stream('codex-cli', req))).at(-1)!;
    expect(last.type === 'error' && last.error.code).toBe('cli');
    expect(last.type === 'error' && last.error.message).toContain('model is not supported');
  });

  it('401 → auth 오류', async () => {
    const client = createBridgeClient(localTransport('logged-out'));
    const last = (await collect(client.stream('codex-cli', req))).at(-1)!;
    expect(last.type === 'error' && last.error.code).toBe('auth');
    expect(last.type === 'error' && last.error.message).toContain('codex login');
  });
});

describe('bridge server — 상태 감지', () => {
  it('로그인됨: 버전과 방식만 표시하고 이메일·키는 노출하지 않는다', async () => {
    const st = await createBridgeClient(localTransport('ok')).status(true);
    expect(st['claude-cli']).toEqual({ status: 'ready', detail: 'Claude Code 9.9.9 · 로그인됨 (claude.ai)' });
    expect(st['codex-cli']).toEqual({ status: 'ready', detail: 'Codex 9.9.9 · 로그인됨 (API 키)' });
    expect(JSON.stringify(st)).not.toMatch(/example\.com|sk-proj/);
  });

  it('미로그인', async () => {
    const st = await createBridgeClient(localTransport('logged-out')).status(true);
    expect(st['claude-cli'].status).toBe('not-logged-in');
    expect(st['codex-cli'].status).toBe('not-logged-in');
  });

  it('미설치', async () => {
    const st = await createBridgeClient(localTransport('ok', { 'claude-cli': '/nonexistent/claude', 'codex-cli': '/nonexistent/codex' })).status(true);
    expect(st['claude-cli'].status).toBe('not-installed');
    expect(st['codex-cli'].status).toBe('not-installed');
  });
});

describe('오류 분류', () => {
  const ctx = { label: 'X CLI', loginHint: 'x login' };
  it('한도/네트워크/기타', () => {
    expect(classifyCliError('429 Too Many Requests', ctx).code).toBe('rate-limit');
    expect(classifyCliError('getaddrinfo ENOTFOUND api', ctx).code).toBe('network');
    expect(classifyCliError('weird', ctx).code).toBe('cli');
  });
  it('비밀 값 제거', () => {
    expect(sanitize('key sk-ant-abcdefghijk1234 a@b.com Bearer abc.def')).toBe('key [redacted] [email] Bearer [redacted]');
  });
});
