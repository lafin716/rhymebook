import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBridgeClient, type BridgeServerMsg, type BridgeTransport, type StreamEvent } from '@branch/core';
import { KB_TOOL_NAMES } from '@branch/core';
import { claudeArgs, codexArgs, createBridgeServer, createClaudeParser, createCodexParser, kbToolNameOf, type CliEnv } from '../src';
import { KB_MCP_SERVER_NAME, KB_MCP_TOOL_PREFIX } from '../src/kbTools/config';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = path.join(dir, 'fixtures/fake-claude.mjs');
const fakeCodex = path.join(dir, 'fixtures/fake-codex.mjs');

// ---------- codexArgs: MCP 설정 ----------

describe('codexArgs — 지식베이스 MCP', () => {
  it('없으면 mcp_servers 설정이 없다', () => {
    expect(codexArgs({}).join(' ')).not.toContain('mcp_servers');
  });

  it('command·args·타임아웃·허용 도구를 -c로 넘긴다', () => {
    const args = codexArgs({ mcp: { command: '/app/electron', args: ['/app/kbMcp.cjs', '--root', '/r', '--kb', 'kbaaaaaa'] } });
    const p = `mcp_servers.${KB_MCP_SERVER_NAME}`;
    expect(args).toContain(`${p}.command="/app/electron"`);
    expect(args).toContain(`${p}.args=["/app/kbMcp.cjs","--root","/r","--kb","kbaaaaaa"]`);
    expect(args.some((a) => a.startsWith(`${p}.startup_timeout_sec=`))).toBe(true);
    expect(args.some((a) => a.startsWith(`${p}.tool_timeout_sec=`))).toBe(true);
    expect(args).toContain(`${p}.enabled_tools=${JSON.stringify(KB_TOOL_NAMES)}`);
    // -c 뒤에 항상 설정 한 쌍이 온다
    args.forEach((a, i) => {
      if (a.startsWith(`${p}.`)) expect(args[i - 1]).toBe('-c');
    });
  });

  it('env 값의 따옴표·역슬래시는 JSON 문자열로 이스케이프된다', () => {
    const args = codexArgs({ mcp: { command: 'x', args: [], env: { ELECTRON_RUN_AS_NODE: '1', TRICKY: 'a"b\\c' } } });
    const envArg = args.find((a) => a.includes('.env='));
    expect(envArg).toBe(`mcp_servers.${KB_MCP_SERVER_NAME}.env={ELECTRON_RUN_AS_NODE = "1", TRICKY = "a\\"b\\\\c"}`);
  });

  it('형식이 틀린 env 키는 던진다 (TOML 주입 방지)', () => {
    expect(() => codexArgs({ mcp: { command: 'x', args: [], env: { 'A] = 1\nB': 'v' } } })).toThrow();
  });
});

// ---------- claudeArgs: MCP 설정 ----------

describe('claudeArgs — 지식베이스 MCP', () => {
  const config = JSON.stringify({ mcpServers: { octobooks: { type: 'stdio', command: 'x', args: [] } } });
  const tools = KB_TOOL_NAMES.map((n) => `${KB_MCP_TOOL_PREFIX}${n}`);

  it('mcp-config와 엄격 모드, 허용 도구 목록을 넣고 --add-dir은 넣지 않는다', () => {
    const args = claudeArgs({ systemFile: '/tmp/s.md', webSearch: true, knowledge: false, kbMcp: { config, tools } });
    const i = args.indexOf('--mcp-config');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe(config);
    expect(args).toContain('--strict-mcp-config');
    const allowed = args[args.indexOf('--allowedTools') + 1]!;
    for (const t of tools) expect(allowed).toContain(t);
    expect(args).not.toContain('--add-dir');
    // 웹 도구는 지식베이스가 있으면 켜지지 않는다
    expect(allowed).not.toContain('WebSearch');
  });

  it('kbMcp가 없으면 mcp-config를 넣지 않는다', () => {
    expect(claudeArgs({ systemFile: '/tmp/s.md' })).not.toContain('--mcp-config');
  });
});

// ---------- 도구 이름 매핑 ----------

describe('kbToolNameOf', () => {
  it('접두어가 붙은 지식베이스 도구만 원래 이름으로 바꾼다', () => {
    expect(kbToolNameOf(`${KB_MCP_TOOL_PREFIX}searchKnowledge`)).toBe('searchKnowledge');
    expect(kbToolNameOf('mcp__other__searchKnowledge')).toBeUndefined();
    expect(kbToolNameOf(`${KB_MCP_TOOL_PREFIX}deleteEverything`)).toBeUndefined();
    expect(kbToolNameOf('Bash')).toBeUndefined();
  });
});

// ---------- 파서: 활동 표시 ----------

describe('Codex 파서 — mcp_tool_call', () => {
  it('지식베이스 도구 시작·완료를 활동으로 바꾸고 다른 서버는 무시한다', () => {
    const p = createCodexParser();
    const item = { id: 'i1', type: 'mcp_tool_call', server: KB_MCP_SERVER_NAME, tool: 'searchKnowledge', arguments: { query: '가지치기' }, status: 'in_progress' };
    const started = p.line({ type: 'item.started', item });
    expect(started).toEqual([{ type: 'tool', tool: { id: 'codex-i1', name: 'searchKnowledge', status: 'running', query: '가지치기' } }]);
    const done = p.line({ type: 'item.completed', item: { ...item, status: 'completed' } });
    expect(done[0]).toMatchObject({ type: 'tool', tool: { id: 'codex-i1', status: 'done' } });
    const failed = p.line({ type: 'item.completed', item: { ...item, status: 'failed' } });
    expect(failed[0]).toMatchObject({ tool: { status: 'error' } });
    const other = p.line({ type: 'item.started', item: { ...item, server: 'someone-else' } });
    expect(other).toEqual([]);
  });
});

describe('Claude 파서 — mcp__octobooks__ 도구', () => {
  it('tool_use를 지식베이스 도구 이름과 질의로 보여준다', () => {
    const p = createClaudeParser();
    const evs = p.line({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu1', name: `${KB_MCP_TOOL_PREFIX}readKnowledgeFile`, input: { kbId: 'kbaaaaaa', path: 'docs/a.md', startLine: 1, endLine: 5 } }] },
    });
    const tool = evs.find((e): e is Extract<StreamEvent, { type: 'tool' }> => e.type === 'tool')?.tool;
    expect(tool).toMatchObject({ name: 'readKnowledgeFile', status: 'running', query: 'docs/a.md' });
  });
});

// ---------- 서버: 여러 KB, fast 모드 ----------

describe('bridge server — 여러 지식베이스 MCP', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kbtools-server-'));
    for (const id of ['kbaaaaaa', 'kbbbbbbb']) {
      mkdirSync(path.join(root, id, 'files'), { recursive: true });
      writeFileSync(path.join(root, id, 'meta.json'), JSON.stringify({ name: `이름-${id}` }));
    }
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function transport(knowledgeTools: boolean): BridgeTransport {
    const cliEnv: CliEnv = {
      env: { ...process.env, FAKE_MODE: 'echo' },
      bin: { 'claude-cli': fakeClaude, 'codex-cli': fakeCodex },
    };
    const server = createBridgeServer({
      cliEnv,
      ...(knowledgeTools ? { knowledgeTools: { command: 'node', args: ['/app/kbMcp.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' }, root } } : {}),
    });
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

  async function echoOf(req: Record<string, unknown>, knowledgeTools = true): Promise<{ args: string[]; system: string }> {
    const client = createBridgeClient(transport(knowledgeTools));
    const evs: StreamEvent[] = [];
    for await (const ev of client.stream('claude-cli', { system: 'tutor', messages: [{ role: 'user', content: 'q' }], ...req } as never)) evs.push(ev);
    const text = evs.map((e) => (e.type === 'delta' ? e.text : '')).join('');
    return JSON.parse(text) as { args: string[]; system: string };
  }

  it('선택한 모든 KB를 --kb로 넘기고 설정에 MCP 서버를 넣는다', async () => {
    const out = await echoOf({ knowledgeIds: ['kbaaaaaa', 'kbbbbbbb'], knowledgeId: 'kbaaaaaa' });
    expect(out.args).toContain('--mcp-config');
    const cfg = JSON.parse(out.args[out.args.indexOf('--mcp-config') + 1]!) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const srv = cfg.mcpServers[KB_MCP_SERVER_NAME]!;
    expect(srv.command).toBe('node');
    expect(srv.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    const kbArgs = srv.args.filter((_, i) => srv.args[i - 1] === '--kb');
    expect(kbArgs).toEqual(['kbaaaaaa', 'kbbbbbbb']);
    expect(srv.args).toContain('--root');
    // 시스템 안내에 KB 이름이 들어간다 (kbId는 안내용으로만)
    expect(out.system).toContain('이름-kbaaaaaa');
    expect(out.system).toContain('이름-kbbbbbbb');
  });

  it('KB 개수는 8개로 자른다', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `kbcccc${String(i).padStart(2, '0')}`);
    for (const id of ids) mkdirSync(path.join(root, id, 'files'), { recursive: true });
    const out = await echoOf({ knowledgeIds: ids });
    const cfg = JSON.parse(out.args[out.args.indexOf('--mcp-config') + 1]!) as { mcpServers: Record<string, { args: string[] }> };
    const kbArgs = cfg.mcpServers[KB_MCP_SERVER_NAME]!.args.filter((_, i, a) => a[i - 1] === '--kb');
    expect(kbArgs).toHaveLength(8);
  });

  it('존재하지 않는 KB만 있으면 MCP를 만들지 않는다', async () => {
    const out = await echoOf({ knowledgeIds: ['kbzzzzzz'] });
    expect(out.args).not.toContain('--mcp-config');
  });

  it('knowledgeIds가 없고 knowledgeId만 있으면 그 하나만 쓴다 (예전 클라이언트)', async () => {
    const out = await echoOf({ knowledgeId: 'kbbbbbbb' });
    const cfg = JSON.parse(out.args[out.args.indexOf('--mcp-config') + 1]!) as { mcpServers: Record<string, { args: string[] }> };
    expect(cfg.mcpServers[KB_MCP_SERVER_NAME]!.args.filter((a) => a === '--kb')).toHaveLength(1);
  });

  it('knowledgeMode가 없거나 auto·semantic·deep이면 도구를 켠다', async () => {
    for (const knowledgeMode of [undefined, 'auto', 'semantic', 'deep']) {
      const out = await echoOf({ knowledgeIds: ['kbaaaaaa'], knowledgeMode });
      expect(out.args, String(knowledgeMode)).toContain('--mcp-config');
    }
  });

  it('deep 모드만 검증 문장을 덧붙인다', async () => {
    const deep = await echoOf({ knowledgeIds: ['kbaaaaaa'], knowledgeMode: 'deep' });
    expect(deep.system).toContain('deep mode');
    const auto = await echoOf({ knowledgeIds: ['kbaaaaaa'], knowledgeMode: 'auto' });
    expect(auto.system).not.toContain('deep mode');
  });

  it('fast 모드는 MCP도 지식 파일도 쓰지 않는다', async () => {
    const out = await echoOf({ knowledgeIds: ['kbaaaaaa'], knowledgeMode: 'fast' });
    expect(out.args).not.toContain('--mcp-config');
    expect(out.args).not.toContain('--add-dir');
  });
});
