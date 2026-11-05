/**
 * 코드 파일 AST 청킹 (ADR-115). tree-sitter(wasm)로 함수·클래스 경계를 찾아 블록을 만들고
 * 심볼 표(정규화 이름·종류·줄 범위·시그니처·주석)를 뽑는다.
 * 문법이 없거나 초기화·파싱이 실패하면 null을 돌려주고, 호출자는 core의 정규식 파서로 되돌아간다.
 *
 * wasm 런타임(@vscode/tree-sitter-wasm)은 번들하지 않는다. tree-sitter.js가 자기 위치로 wasm을 찾으므로
 * 디스크 디렉터리(dir)에서 createRequire로 읽는다. 데스크톱 패키지는 dist/treesitter를 asarUnpack한다.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ParsedBlock } from '@branch/core';

/** 청커 버전. 바뀌면 다음 색인에서 코드 문서를 다시 청킹한다 */
export const AST_CHUNKER_ID = 'ast1';
export const REGEX_CHUNKER_ID = 'regex';

export interface CodeSymbol {
  /** 정규화 이름 (컨테이너 포함: `Class.method`) */
  name: string;
  kind: string;
  /** 1부터, 포함 */
  lineStart: number;
  lineEnd: number;
  /** 정의 첫 줄 (200자 이하) */
  signature: string;
  /** 앞 주석·docstring (300자 이하) */
  doc?: string;
}

export interface CodeParseResult {
  blocks: ParsedBlock[];
  symbols: CodeSymbol[];
}

export interface CodeParser {
  /** 초기화 결과에 따른 청커 id (AST 사용 가능하면 ast1, 아니면 regex) */
  chunkerId(): Promise<string>;
  /** 지원 언어가 아니거나 실패하면 null */
  parse(relPath: string, text: string): Promise<CodeParseResult | null>;
}

/** 확장자 → 문법 wasm 이름 */
const GRAMMAR_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'c-sharp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
};

export function grammarOf(relPath: string): string | undefined {
  const ext = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase();
  return GRAMMAR_BY_EXT[ext];
}

/** 이 크기를 넘는 컨테이너(클래스 등)는 멤버 단위로 나눈다 */
export const CONTAINER_SPLIT_CHARS = 1600;
/** 이보다 큰 파일·평균 줄 길이(압축된 번들)는 정규식으로 처리한다 */
const MAX_AST_CHARS = 1_000_000;
const MAX_AVG_LINE = 400;
const MAX_DEPTH = 4;

// ── tree-sitter 최소 타입 (web-tree-sitter.d.ts의 일부) ──

interface TsPoint {
  row: number;
  column: number;
}
interface TsNode {
  type: string;
  text: string;
  startPosition: TsPoint;
  endPosition: TsPoint;
  namedChildren: (TsNode | null)[];
  childForFieldName(name: string): TsNode | null;
}
interface TsTree {
  rootNode: TsNode;
  delete(): void;
}
interface TsParser {
  setLanguage(lang: unknown): TsParser;
  parse(text: string): TsTree | null;
}
interface TsModule {
  Parser: { init(opts: { locateFile: (f: string) => string }): Promise<void>; new (): TsParser };
  Language: { load(p: string): Promise<unknown> };
}

// ── 정의 판별 ──

const DEF_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_definition',
  'function_item',
  'method_definition',
  'method_declaration',
  'method',
  'singleton_method',
  'constructor_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'class_definition',
  'class',
  'class_specifier',
  'struct_specifier',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'enum_item',
  'struct_item',
  'trait_item',
  'impl_item',
  'mod_item',
  'module',
  'namespace_declaration',
  'namespace_definition',
  'internal_module',
  'type_declaration',
  'record_declaration',
  'struct_declaration',
  'trait_declaration',
]);

/** 멤버로 나눌 수 있는 정의 */
const CONTAINER_RE = /class|interface|impl_item|trait|module|namespace|mod_item|struct_specifier|struct_declaration|record/;

const FUNC_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function', 'class']);

const NAME_TYPES = /identifier|name|constant|property_identifier|type_identifier/;

function kindOf(type: string, inContainer: boolean): string {
  if (/method|constructor/.test(type)) return 'method';
  if (/function|arrow/.test(type)) return inContainer ? 'method' : 'function';
  if (/interface/.test(type)) return 'interface';
  if (/class/.test(type)) return 'class';
  if (/type_alias|type_declaration/.test(type)) return 'type';
  if (/enum/.test(type)) return 'enum';
  if (/struct|record/.test(type)) return 'struct';
  if (/trait/.test(type)) return 'trait';
  if (/impl/.test(type)) return 'impl';
  return 'module';
}

interface Def {
  /** 줄 범위·본문을 가진 바깥 노드 (export·decorator 포함) */
  outer: TsNode;
  /** 실제 정의 노드 */
  node: TsNode;
  name: string;
  kind: string;
}

function identText(n: TsNode | null, depth = 0): string | undefined {
  if (!n || depth > 6) return undefined;
  if (NAME_TYPES.test(n.type) && !n.namedChildren.length) return n.text;
  // qualified_identifier, scoped_identifier 등은 전체 텍스트를 쓴다
  if (/qualified|scoped|scope_resolution/.test(n.type)) return n.text.replace(/\s+/g, '');
  const inner = n.childForFieldName('declarator') ?? n.childForFieldName('name');
  if (inner) return identText(inner, depth + 1);
  for (const c of n.namedChildren) {
    if (c && NAME_TYPES.test(c.type)) return identText(c, depth + 1);
  }
  return undefined;
}

function nameOf(n: TsNode): string | undefined {
  const name = n.childForFieldName('name');
  if (name) return identText(name) ?? name.text;
  const decl = n.childForFieldName('declarator');
  if (decl) return identText(decl);
  const type = n.childForFieldName('type'); // rust impl_item
  if (type) return type.text.replace(/\s+/g, '');
  // go type_declaration: type_spec(name)
  for (const c of n.namedChildren) {
    if (c && /_spec$/.test(c.type)) {
      const nm = c.childForFieldName('name');
      if (nm) return nm.text;
    }
  }
  return undefined;
}

/** go 메서드 수신자 타입 (`func (s *Server) Run()` → Server) */
function goReceiver(n: TsNode): string | undefined {
  const recv = n.childForFieldName('receiver');
  if (!recv) return undefined;
  const m = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\)\s*$/.exec(recv.text);
  return m?.[1];
}

/** 노드가 정의면 Def, 아니면 null. export·decorator·template 감싸기를 벗긴다 */
function defOf(outer: TsNode, inContainer: boolean): Def | null {
  let node: TsNode | null = outer;
  for (let i = 0; i < 3 && node; i++) {
    if (node.type === 'export_statement') node = node.childForFieldName('declaration') ?? node.namedChildren.find((c) => c && DEF_TYPES.has(c.type)) ?? null;
    else if (node.type === 'decorated_definition') node = node.childForFieldName('definition');
    else if (node.type === 'template_declaration') node = node.namedChildren.filter(Boolean).at(-1) ?? null;
    else if (node.type === 'expression_statement' && node.namedChildren.length === 1 && node.namedChildren[0]?.type === 'internal_module') {
      node = node.namedChildren[0];
    } else break;
  }
  if (!node) return null;

  if (DEF_TYPES.has(node.type)) {
    let name = nameOf(node);
    if (!name) return null;
    if (node.type === 'method_declaration' && !inContainer) {
      const recv = goReceiver(node);
      if (recv) name = `${recv}.${name}`;
    }
    return { outer, node, name, kind: kindOf(node.type, inContainer) };
  }

  // const handler = () => {} / const Foo = class {}
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    const decls = node.namedChildren.filter((c): c is TsNode => !!c && c.type === 'variable_declarator');
    if (decls.length !== 1) return null;
    const d = decls[0]!;
    const value = d.childForFieldName('value');
    const name = d.childForFieldName('name');
    if (!value || !name || !FUNC_VALUE_TYPES.has(value.type) || !NAME_TYPES.test(name.type)) return null;
    return { outer, node: value, name: name.text, kind: value.type === 'class' ? 'class' : inContainer ? 'method' : 'function' };
  }

  // 클래스 필드 화살표 함수: handle = () => {}
  if (inContainer && (node.type === 'public_field_definition' || node.type === 'field_definition')) {
    const value = node.childForFieldName('value');
    const name = node.childForFieldName('name') ?? node.childForFieldName('property');
    if (value && name && FUNC_VALUE_TYPES.has(value.type)) return { outer, node: value, name: name.text, kind: 'method' };
  }
  return null;
}

const isComment = (n: TsNode) => /comment/.test(n.type);

function bodyOf(n: TsNode): TsNode | null {
  const body = n.childForFieldName('body');
  if (body) return body;
  for (const c of n.namedChildren) {
    if (c && /body|block|declaration_list|field_declaration_list|class_body/.test(c.type)) return c;
  }
  return null;
}

function cleanComment(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\/\*\*?|\*\/|\*|\/\/\/?|#+|--)\s?/, '').replace(/\*\/\s*$/, '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 300);
}

/** python docstring: body 첫 문장이 문자열이면 */
function docstringOf(def: TsNode): string | undefined {
  const body = def.childForFieldName('body');
  const first = body?.namedChildren[0];
  if (!first || first.type !== 'expression_statement') return undefined;
  const s = first.namedChildren[0];
  if (!s || s.type !== 'string') return undefined;
  return s.text.replace(/^[rubf]*("""|'''|"|')/i, '').replace(/("""|'''|"|')$/, '').replace(/\s+/g, ' ').trim().slice(0, 300) || undefined;
}

// ── 블록 구성 ──

interface Ctx {
  lines: string[];
  lang: string;
  blocks: ParsedBlock[];
  symbols: CodeSymbol[];
  /** 다음 블록이 시작할 수 있는 최소 줄(0부터) */
  cursor: number;
}

function pushBlock(ctx: Ctx, startRow: number, endRow: number, symbol: string | undefined): void {
  const from = Math.max(startRow, ctx.cursor);
  if (endRow < from) return;
  const text = ctx.lines.slice(from, endRow + 1).join('\n');
  ctx.cursor = endRow + 1;
  if (!text.trim()) return;
  ctx.blocks.push(
    symbol
      ? { type: 'symbol', symbol, text, lang: ctx.lang, lineStart: from + 1, lineEnd: endRow + 1 }
      : { type: 'code', text, lang: ctx.lang, lineStart: from + 1, lineEnd: endRow + 1 },
  );
}

function recordSymbol(ctx: Ctx, def: Def, qname: string, comments: TsNode[]): void {
  const startRow = def.outer.startPosition.row;
  const signature = (ctx.lines[def.node.startPosition.row] ?? '').trim().slice(0, 200);
  const doc = comments.length ? cleanComment(comments.map((c) => c.text).join('\n')) : docstringOf(def.node);
  ctx.symbols.push({
    name: qname,
    kind: def.kind,
    lineStart: startRow + 1,
    lineEnd: def.outer.endPosition.row + 1,
    signature,
    doc: doc || undefined,
  });
}

/** 컨테이너 안의 정의를 심볼 표에만 넣는다 (블록은 나누지 않음) */
function collectNested(ctx: Ctx, def: Def, qname: string, depth: number): void {
  if (depth >= MAX_DEPTH || !CONTAINER_RE.test(def.node.type)) return;
  const body = bodyOf(def.node);
  if (!body) return;
  let comments: TsNode[] = [];
  for (const c of body.namedChildren) {
    if (!c) continue;
    if (isComment(c)) {
      comments.push(c);
      continue;
    }
    const d = defOf(c, true);
    if (d) {
      const q = `${qname}.${d.name}`;
      recordSymbol(ctx, d, q, adjacent(comments, c));
      collectNested(ctx, d, q, depth + 1);
    }
    comments = [];
  }
}

/** 정의 바로 앞(빈 줄 없이)에 붙은 주석들 */
function adjacent(comments: TsNode[], def: TsNode): TsNode[] {
  const out: TsNode[] = [];
  let next = def.startPosition.row;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]!;
    if (c.endPosition.row < next - 1) break;
    out.unshift(c);
    next = c.startPosition.row;
  }
  return out;
}

/**
 * 형제 노드 목록을 블록으로 바꾼다. 정의는 앞 주석과 함께 symbol 블록, 사이 코드는 code 블록
 * (컨테이너 안이면 컨테이너 이름의 symbol 블록).
 */
function walk(ctx: Ctx, nodes: TsNode[], prefix: string | undefined, depth: number): void {
  let gapStart: number | null = null;
  let gapEnd = -1;
  let comments: TsNode[] = [];

  const flushGap = (beforeRow: number) => {
    if (gapStart !== null) pushBlock(ctx, gapStart, Math.min(gapEnd, beforeRow - 1), prefix);
    gapStart = null;
  };
  const addGap = (n: TsNode) => {
    if (gapStart === null) gapStart = n.startPosition.row;
    gapEnd = Math.max(gapEnd, n.endPosition.row);
  };

  for (const n of nodes) {
    if (isComment(n)) {
      comments.push(n);
      continue;
    }
    const def = defOf(n, prefix !== undefined);
    if (!def) {
      for (const c of comments) addGap(c);
      comments = [];
      addGap(n);
      continue;
    }
    const attached = adjacent(comments, n);
    for (const c of comments) if (!attached.includes(c)) addGap(c);
    comments = [];
    const startRow = attached[0]?.startPosition.row ?? n.startPosition.row;
    flushGap(startRow);

    const qname = prefix ? `${prefix}.${def.name}` : def.name;
    recordSymbol(ctx, def, qname, attached);

    const endRow = n.endPosition.row;
    const size = ctx.lines.slice(startRow, endRow + 1).join('\n').length;
    const body = CONTAINER_RE.test(def.node.type) ? bodyOf(def.node) : null;
    const members = body?.namedChildren.filter((c): c is TsNode => !!c) ?? [];
    if (size > CONTAINER_SPLIT_CHARS && depth < MAX_DEPTH && members.length > 0) {
      // 컨테이너 머리(선언 줄 ~ 첫 멤버 전)를 따로 두고, 멤버를 `이름.멤버`로 나눈다
      const firstRow = members[0]!.startPosition.row;
      pushBlock(ctx, startRow, Math.max(startRow, firstRow - 1), qname);
      walk(ctx, members, qname, depth + 1);
      // 닫는 줄(`}` 등)은 마지막 블록 뒤에 남는다. 내용이 있으면 컨테이너 블록으로 둔다
      if (ctx.lines.slice(ctx.cursor, endRow + 1).some((l) => /[^\s{}();]/.test(l))) pushBlock(ctx, ctx.cursor, endRow, qname);
      else ctx.cursor = Math.max(ctx.cursor, endRow + 1);
    } else {
      pushBlock(ctx, startRow, endRow, qname);
      collectNested(ctx, def, qname, depth);
    }
  }
  for (const c of comments) addGap(c);
  flushGap(Number.MAX_SAFE_INTEGER);
}

// ── 로더 ──

export interface CodeParserOptions {
  /** tree-sitter.js와 *.wasm이 있는 디렉터리. 없으면 항상 null (정규식 대체) */
  dir?: string;
  log?: (msg: string) => void;
}

export function createCodeParser(opts: CodeParserOptions): CodeParser {
  let ready: Promise<TsModule | null> | null = null;
  const parsers = new Map<string, Promise<TsParser | null>>();

  const init = (): Promise<TsModule | null> => {
    if (!opts.dir) return Promise.resolve(null);
    ready ??= (async () => {
      try {
        const dir = opts.dir!;
        const req = createRequire(path.join(dir, 'noop.js'));
        const mod = req(path.join(dir, 'tree-sitter.js')) as TsModule;
        await mod.Parser.init({ locateFile: (f: string) => path.join(dir, f) });
        return mod;
      } catch (err) {
        opts.log?.(`tree-sitter unavailable: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })();
    return ready;
  };

  const parserFor = (grammar: string): Promise<TsParser | null> => {
    let p = parsers.get(grammar);
    if (!p) {
      p = (async () => {
        const mod = await init();
        if (!mod) return null;
        try {
          const lang = await mod.Language.load(path.join(opts.dir!, `tree-sitter-${grammar}.wasm`));
          return new mod.Parser().setLanguage(lang);
        } catch (err) {
          opts.log?.(`tree-sitter grammar ${grammar} failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      })();
      parsers.set(grammar, p);
    }
    return p;
  };

  return {
    async chunkerId() {
      return (await init()) ? AST_CHUNKER_ID : REGEX_CHUNKER_ID;
    },
    async parse(relPath, text) {
      const grammar = grammarOf(relPath);
      if (!grammar) return null;
      const lines = text.split('\n');
      if (text.length > MAX_AST_CHARS || text.length / Math.max(1, lines.length) > MAX_AVG_LINE) return null;
      const parser = await parserFor(grammar);
      if (!parser) return null;
      let tree: TsTree | null = null;
      try {
        tree = parser.parse(text);
        if (!tree) return null;
        const ctx: Ctx = { lines, lang: grammar === 'tsx' ? 'typescript' : grammar, blocks: [], symbols: [], cursor: 0 };
        walk(ctx, tree.rootNode.namedChildren.filter((c): c is TsNode => !!c), undefined, 0);
        if (ctx.blocks.length === 0) return null;
        return { blocks: ctx.blocks, symbols: ctx.symbols };
      } catch (err) {
        opts.log?.(`tree-sitter parse failed for ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        tree?.delete();
      }
    },
  };
}
