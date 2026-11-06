import { describe, expect, it } from 'vitest';
import { KnowledgePolicyError } from '@branch/core';
import { claudeArgs, codexArgs } from '../src';
import { validateClientMsg } from '../src/remote/server';
import {
  assertIndexSettingsAllowed,
  assertKindChangeAllowed,
  assertReindexAllowed,
  assertVectorOpAllowed,
  guardMessage,
  kbCreateOptsArg,
  kbExcludesArg,
  kbIdArg,
  kbKindArg,
  kbReindexOptsArg,
  KbArgError,
  resolveLinkedDir,
} from '../../../apps/desktop/src/kbGuard';

const ID = 'kbaaaaaa';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof KnowledgePolicyError ? err.code : undefined;
  }
}

describe('데스크톱 IPC 인자 검증 (kbGuard)', () => {
  it('id는 형식이 맞아야 한다', () => {
    expect(kbIdArg(ID)).toBe(ID);
    expect(() => kbIdArg('../etc')).toThrow(KbArgError);
    expect(() => kbIdArg(undefined)).toThrow(KbArgError);
  });

  it('kind는 codebase 또는 document만 받는다', () => {
    expect(kbKindArg('codebase')).toBe('codebase');
    expect(kbKindArg('document')).toBe('document');
    expect(() => kbKindArg('legacy')).toThrow(KbArgError);
    expect(() => kbKindArg(1)).toThrow(KbArgError);
  });

  it('excludes는 배열이어야 하고 `..`·절대 경로를 정리해서 버린다', () => {
    expect(() => kbExcludesArg('node_modules')).toThrow(KbArgError);
    expect(kbExcludesArg(['dist', '../secret', '/abs', ' dist ', '# 주석', 'build/'])).toEqual(['dist', '/abs', 'build/']);
  });

  it('reindex 옵션은 타입과 paths 개수를 검사한다', () => {
    expect(kbReindexOptsArg(undefined)).toEqual({ full: false, retryFailed: false });
    expect(kbReindexOptsArg({ full: true })).toEqual({ full: true, retryFailed: false });
    expect(() => kbReindexOptsArg({ full: 'yes' })).toThrow(KbArgError);
    expect(() => kbReindexOptsArg({ paths: 'a.md' })).toThrow(KbArgError);
    expect(() => kbReindexOptsArg({ paths: ['../x'] })).toThrow(KbArgError);
    expect(() => kbReindexOptsArg({ paths: Array.from({ length: 501 }, (_, i) => `f${i}.md`) })).toThrow(KbArgError);
  });

  it('create 옵션: linkedPath는 절대 경로이고 codebase에서만 허용', () => {
    expect(kbCreateOptsArg(undefined)).toEqual({});
    expect(kbCreateOptsArg({ kind: 'codebase', linkedPath: '/Users/me/repo', excludes: ['dist'] })).toEqual({
      kind: 'codebase',
      linkedPath: '/Users/me/repo',
      excludes: ['dist'],
    });
    expect(() => kbCreateOptsArg({ kind: 'document', linkedPath: '/Users/me/repo' })).toThrow(KbArgError);
    expect(() => kbCreateOptsArg({ kind: 'codebase', linkedPath: 'relative/repo' })).toThrow(KbArgError);
    expect(() => kbCreateOptsArg({ kind: 'codebase', linkedPath: '/a\0b' })).toThrow(KbArgError);
    expect(() => kbCreateOptsArg({ kind: 'bogus' })).toThrow(KbArgError);
  });

  it('resolveLinkedDir: 디렉터리가 아니거나 없으면 거부하고 realpath를 돌려준다', async () => {
    const fake = {
      realpath: async (p: string) => {
        if (p === '/link') return '/real/repo';
        if (p === '/file') return '/real/file.txt';
        throw new Error('ENOENT');
      },
      stat: async (p: string) => ({ isDirectory: () => p === '/real/repo' }),
    } as never;
    await expect(resolveLinkedDir('/link', fake)).resolves.toBe('/real/repo');
    await expect(resolveLinkedDir('/file', fake)).rejects.toBeInstanceOf(KbArgError);
    await expect(resolveLinkedDir('/missing', fake)).rejects.toBeInstanceOf(KbArgError);
    await expect(resolveLinkedDir('relative', fake)).rejects.toBeInstanceOf(KbArgError);
  });
});

describe('코드베이스 정책 가드 (ADR-127): store에 닿기 전에 막는다', () => {
  it('재색인(full·paths·retryFailed 모두)은 codebase에서 codebase_index_forbidden', () => {
    expect(codeOf(() => assertReindexAllowed(ID, 'codebase'))).toBe('codebase_index_forbidden');
    expect(codeOf(() => assertReindexAllowed(ID, 'document'))).toBeUndefined();
    expect(codeOf(() => assertReindexAllowed(ID, undefined))).toBeUndefined();
  });

  it('색인 설정 변경은 codebase에서 거부', () => {
    expect(codeOf(() => assertIndexSettingsAllowed(ID, 'codebase'))).toBe('codebase_index_forbidden');
    expect(codeOf(() => assertIndexSettingsAllowed(ID, 'document'))).toBeUndefined();
  });

  it('벡터·무결성 작업은 codebase에서 거부', () => {
    expect(codeOf(() => assertVectorOpAllowed(ID, 'codebase'))).toBe('codebase_index_forbidden');
    expect(codeOf(() => assertVectorOpAllowed(ID, 'document'))).toBeUndefined();
  });

  it('연결 폴더 코드베이스는 문서형으로 바꿀 수 없다 (linked_kind_locked)', () => {
    const linked = { kind: 'codebase' as const, linkedPath: '/Users/me/repo' };
    expect(codeOf(() => assertKindChangeAllowed(ID, linked, 'document'))).toBe('linked_kind_locked');
    expect(codeOf(() => assertKindChangeAllowed(ID, linked, 'codebase'))).toBeUndefined();
    expect(codeOf(() => assertKindChangeAllowed(ID, { kind: 'document' }, 'codebase'))).toBeUndefined();
  });

  it('렌더러용 메시지는 코드를 접두로 담는다', () => {
    const err = new KnowledgePolicyError('codebase_index_forbidden', 'reindex is not allowed');
    expect(guardMessage(err)).toBe('kb-guard:codebase_index_forbidden: reindex is not allowed');
  });
});

describe('CLI 연결 (ADR-124·128): 연결된 코드베이스', () => {
  const base = { systemFile: 's.txt' };

  it('예전 방식(폴더 직접 읽기)은 연결 폴더를 --add-dir로 주되 Read·Glob·Grep만, 쓰기·셸 없음', () => {
    const linkedDir = '/Users/me/repo';
    const args = claudeArgs({ ...base, knowledge: true, knowledgeDir: linkedDir });
    expect(args[args.indexOf('--add-dir') + 1]).toBe(linkedDir);
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    const tools = (args[args.indexOf('--tools') + 1] ?? '').split(',');
    for (const forbidden of ['Bash', 'Edit', 'Write', 'NotebookEdit']) expect(tools).not.toContain(forbidden);
    expect(args).not.toContain('--allowedTools');
  });

  it('MCP 방식에서는 --add-dir·내장 도구가 없고 KB 도구만 허용한다', () => {
    const config = JSON.stringify({ mcpServers: { octobooks: { type: 'stdio', command: '/app/electron', args: ['/app/kbMcp.cjs'] } } });
    const args = claudeArgs({ ...base, knowledge: false, kbMcp: { config, tools: ['mcp__octobooks__kb_search'] } });
    expect(args).not.toContain('--add-dir');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__octobooks__kb_search');
    expect(args).toContain('--strict-mcp-config');
  });

  it('Codex는 읽기 전용 샌드박스·셸 끔·MCP 설정만 쓴다', () => {
    const args = codexArgs({ mcp: { command: '/app/electron', args: ['/app/kbMcp.cjs'] } });
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args.join(' ')).not.toMatch(/danger-full-access|workspace-write/);
  });
});

describe('원격 서버: 지식베이스 관리 메시지는 받지 않는다', () => {
  it('knowledge.* 메시지는 모두 버린다 (지식베이스는 PC 앱에서만 관리)', () => {
    const reqId = 'req-1';
    for (const type of [
      'knowledge.create',
      'knowledge.reindex',
      'knowledge.setKind',
      'knowledge.setExcludes',
      'knowledge.setIndexSettings',
      'knowledge.inspectFolder',
      'knowledge.restoreIndexBackup',
    ]) {
      expect(validateClientMsg({ type, reqId, id: ID, kind: 'codebase' })).toBeNull();
    }
  });
});
