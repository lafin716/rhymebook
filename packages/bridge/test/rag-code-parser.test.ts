import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodeParser, grammarOf } from '../src/rag/codeParser';

const require = createRequire(import.meta.url);
const dir = path.dirname(require.resolve('@vscode/tree-sitter-wasm'));

const TS = `import { x } from './x';

/** 사용자를 id로 찾는다 */
export function getUserById(id: string) {
  return db.find(id);
}

// 핸들러
const onClick = async (e: Event) => {
  console.log(e);
};

export class UserService {
  private cache = new Map();
  /** 저장 */
  save(u: User) {
    return u;
  }
}

export default 42;
`;

const PY = `import os

def load(path):
    """경로를 읽는다"""
    return open(path).read()

class Store:
    def get(self, k):
        return k
`;

const GO = `package main

// Server serves.
type Server struct {
\taddr string
}

func (s *Server) Run() error {
\treturn nil
}

func main() {}
`;

describe('codeParser (tree-sitter)', () => {
  const parser = createCodeParser({ dir });

  it('chunkerId is ast1 when wasm loads', async () => {
    expect(await parser.chunkerId()).toBe('ast1');
  });

  it('TypeScript: functions, arrow, class with members and leading comments', async () => {
    const r = (await parser.parse('src/a.ts', TS))!;
    expect(r).not.toBeNull();
    const names = r.symbols.map((s) => s.name);
    expect(names).toEqual(['getUserById', 'onClick', 'UserService', 'UserService.save']);
    const get = r.symbols[0]!;
    expect(get.kind).toBe('function');
    expect(get.lineStart).toBe(4); // 정의 줄 (블록은 주석 포함)
    expect(get.doc).toContain('사용자를 id로');
    expect(get.signature).toContain('export function getUserById');
    expect(r.symbols[3]!.kind).toBe('method');
    const symBlocks = r.blocks.filter((b) => b.type === 'symbol').map((b) => b.symbol);
    expect(symBlocks).toEqual(['getUserById', 'onClick', 'UserService']);
    expect(r.blocks[0]!.type).toBe('code');
    const getBlock = r.blocks.find((b) => b.symbol === 'getUserById')!;
    expect(getBlock.text.startsWith('/** 사용자를')).toBe(true);
    expect(r.blocks.at(-1)!.text).toContain('export default 42');
    // 줄 범위는 단조 증가
    for (let i = 1; i < r.blocks.length; i++) expect(r.blocks[i]!.lineStart!).toBeGreaterThan(r.blocks[i - 1]!.lineEnd!);
  });

  it('splits large classes into qualified member blocks', async () => {
    const body = Array.from({ length: 12 }, (_, i) => `  method${i}(a: number) {\n    return a + ${i} + ${'x'.repeat(120)}.length;\n  }`).join('\n');
    const src = `export class Big {\n  field = 1;\n${body}\n}\n`;
    const r = (await parser.parse('big.ts', src))!;
    const syms = r.blocks.filter((b) => b.type === 'symbol').map((b) => b.symbol);
    expect(syms).toContain('Big');
    expect(syms).toContain('Big.method0');
    expect(syms).toContain('Big.method11');
    expect(r.symbols.find((s) => s.name === 'Big.method3')?.kind).toBe('method');
  });

  it('Python: def, class methods, docstring', async () => {
    const r = (await parser.parse('m.py', PY))!;
    expect(r.symbols.map((s) => s.name)).toEqual(['load', 'Store', 'Store.get']);
    expect(r.symbols[0]!.doc).toBe('경로를 읽는다');
  });

  it('Go: receiver-qualified methods and type specs', async () => {
    const r = (await parser.parse('main.go', GO))!;
    expect(r.symbols.map((s) => s.name)).toEqual(['Server', 'Server.Run', 'main']);
    expect(r.symbols[0]!.doc).toBe('Server serves.');
  });

  it('returns null for unsupported languages and without wasm dir', async () => {
    expect(await parser.parse('a.kt', 'fun main() {}')).toBeNull();
    const none = createCodeParser({});
    expect(await none.chunkerId()).toBe('regex');
    expect(await none.parse('a.ts', 'function a() {}')).toBeNull();
    const bad = createCodeParser({ dir: '/nonexistent' });
    expect(await bad.chunkerId()).toBe('regex');
    expect(grammarOf('x.tsx')).toBe('tsx');
  });
});
