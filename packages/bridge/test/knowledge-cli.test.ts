import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { t, type BridgeServerMsg } from '@branch/core';
import { claudeArgs, createBridgeServer, createKnowledgeStore, type CliEnv } from '../src';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = path.join(dir, 'fixtures/fake-claude.mjs');
const fakeCodex = path.join(dir, 'fixtures/fake-codex.mjs');

const tmpDirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

function cliEnv(mode: string): CliEnv {
  return {
    env: { ...process.env, FAKE_MODE: mode },
    bin: { 'claude-cli': fakeClaude, 'codex-cli': fakeCodex },
  };
}

interface Outcome {
  text: string;
  errors: string[];
}

/** chat.start를 서버에 직접 보내고 결과를 모은다 (knowledgeId를 그대로 넘긴다) */
async function chat(
  server: ReturnType<typeof createBridgeServer>,
  providerId: 'claude-cli' | 'codex-cli',
  knowledgeId: unknown,
): Promise<Outcome> {
  const reqId = `rq${Math.random().toString(36).slice(2, 10)}`;
  const out: Outcome = { text: '', errors: [] };
  let finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  const conn = server.connect((m: BridgeServerMsg) => {
    if (m.reqId !== reqId) return;
    if (m.type === 'chat.delta') out.text += m.text;
    else if (m.type === 'chat.error') {
      out.errors.push(m.error.message);
      finish();
    } else if (m.type === 'chat.done') finish();
  });
  conn.receive({
    type: 'chat.start',
    reqId,
    providerId,
    system: '튜터 지시',
    messages: [{ role: 'user', content: '질문' }],
    ...(knowledgeId === undefined ? {} : { knowledgeId }),
  } as never);
  await finished;
  return out;
}

/** echo 모드 결과에서 작업 폴더(cwd)와 임시 폴더 이름만 뺀다 (매번 다르다) */
function normalize(text: string): Record<string, unknown> {
  const { cwd: _cwd, ...rest } = JSON.parse(text.replace(/branch-bridge-[A-Za-z0-9]+/g, 'branch-bridge-X')) as Record<string, unknown>;
  return rest;
}

describe('claudeArgs — 지식베이스 도구', () => {
  const base = { systemFile: 's.txt' };

  it('지식베이스가 없으면 --tools는 빈 값, --allowedTools는 없다 (기존과 같음)', () => {
    const args = claudeArgs(base);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--add-dir');
  });

  it('웹 검색만 켜면 --tools와 --allowedTools 모두 웹 도구만 (기존과 같음)', () => {
    const args = claudeArgs({ ...base, webSearch: true });
    expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch');
  });

  it('지식베이스가 켜지면 Read,Glob,Grep은 --tools에만 들어가고 --allowedTools에는 들어가지 않는다', () => {
    const args = claudeArgs({ ...base, knowledge: true, knowledgeDir: '/kb/files' });
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(args).not.toContain('--allowedTools');
  });

  it('지식베이스가 있으면 웹 검색을 켜도 웹 도구를 끈다 (자료 내용 유출 방지)', () => {
    const args = claudeArgs({ ...base, webSearch: true, knowledge: true, knowledgeDir: '/kb/files' });
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(args).not.toContain('--allowedTools');
  });

  it('--add-dir은 지식베이스 폴더를 가리키고 인자 목록 맨 마지막에 온다', () => {
    const args = claudeArgs({ ...base, model: 'sonnet', knowledge: true, knowledgeDir: '/kb/files' });
    const i = args.indexOf('--add-dir');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('/kb/files');
    expect(i + 2).toBe(args.length);
  });

  it('knowledgeDir가 없으면 --add-dir을 넣지 않는다', () => {
    expect(claudeArgs({ ...base, knowledge: true })).not.toContain('--add-dir');
  });
});

describe('bridge server — 지식베이스 연결 (ADR-107)', () => {
  it('지식베이스가 있으면 Claude는 읽기 도구·폴더·안내 문구를 받고, Codex는 파일 목록 안내만 받는다', async () => {
    const root = await tmp('kb-cli-');
    const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });
    const kb = await store.create('생물');
    await store.addFiles(kb.id, [{ name: 'a.txt', data: new TextEncoder().encode('내용') }]);

    const claude = createBridgeServer({ cliEnv: cliEnv('echo'), knowledge: store });
    const c = await chat(claude, 'claude-cli', kb.id);
    const echo = normalize(c.text) as { args: string[]; system: string };
    expect(echo.args[echo.args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(echo.args).not.toContain('--allowedTools');
    expect(echo.args[echo.args.length - 1]).toBe(store.dirFor(kb.id));
    expect(echo.system).toContain('튜터 지시');
    expect(echo.system).toContain('a.txt');

    const codex = createBridgeServer({ cliEnv: cliEnv('echo'), knowledge: store });
    const x = await chat(codex, 'codex-cli', kb.id);
    const note = t('bridge.knowledge.codexIndex', { total: 1, shown: 1, paths: 'a.txt' });
    expect(x.text).toContain(note);
    // 샌드박스·셸 차단은 지식베이스가 있어도 그대로 (ADR-070)
    const args = (JSON.parse(x.text) as { args: string[] }).args;
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args.join(' ')).toContain('features.shell_tool=false');
  });

  it('없는 지식베이스·형식이 틀린 id는 지식베이스가 없을 때와 똑같이 답한다', async () => {
    const root = await tmp('kb-unknown-');
    const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });

    const plain = await chat(createBridgeServer({ cliEnv: cliEnv('echo') }), 'claude-cli', undefined);
    const unknown = await chat(createBridgeServer({ cliEnv: cliEnv('echo'), knowledge: store }), 'claude-cli', 'kbzzzzzzzz');
    const invalid = await chat(createBridgeServer({ cliEnv: cliEnv('echo'), knowledge: store }), 'claude-cli', '../../etc');

    expect(unknown.errors).toEqual([]);
    expect(invalid.errors).toEqual([]);
    expect(normalize(unknown.text)).toEqual(normalize(plain.text));
    expect(normalize(invalid.text)).toEqual(normalize(plain.text));
  });
});
