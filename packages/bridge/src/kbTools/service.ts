import {
  KB_TOOL_LIMITS,
  KB_TOOL_NAMES,
  KbToolBudget,
  KbToolError,
  parseFindDefinitionsInput,
  parseFindFilesInput,
  parseGrepInput,
  parseListDirectoryInput,
  parseOutlineInput,
  parseReadFileInput,
  parseSearchKnowledgeInput,
  searchPolicyOf,
  type FindDefinitionsOutput,
  type FindFilesOutput,
  type GetKnowledgeOutlineOutput,
  type GrepKnowledgeOutput,
  type KbOutlineItem,
  type KbSearchItem,
  type KbToolName,
  type KnowledgeKind,
  type ListKnowledgeDirectoryOutput,
  type ReadKnowledgeFileOutput,
  type SearchKnowledgeOutput,
} from '@branch/core';
import {
  CodebaseAbortError,
  entryFilterFor,
  findDefinitions,
  findFiles,
  grep,
  readCodebaseLines,
  readCodebaseRange,
  searchCodebase,
  type CodebaseTarget,
  type ScanStats,
} from '../codebase';
import { listDir, outlineOfLines, readText, resolveInside, isMarkdownPath } from './files';
import { indexedSearch } from './indexSearch';
import { FOLDER_HINT_MAX, folderHintsFromMeta, folderMetaOf, inPathPrefix } from './folderHints';
import { keywordSearch, type SearchKb } from './search';
import { mergeFairly } from './merge';

export interface KbEntry {
  kbId: string;
  kbName: string;
  /**
   * 원본 루트. 문서형은 <root>/<kbId>/files, 연결 폴더 코드베이스는 그 폴더(realpath).
   * 이 아래만 읽는다.
   */
  filesRoot: string;
  /** undefined = 미분류 (문서형으로 동작) */
  kind?: KnowledgeKind;
  /** 사용자 제외 패턴 (코드베이스 탐색에서 적용) */
  excludes?: string[];
  /** 연결 폴더가 사라졌다 (코드베이스). 도구 호출은 not_found, 검색은 건너뜀 */
  missing?: boolean;
}

export interface KbToolResult {
  text: string;
  isError: boolean;
}

export interface KbToolServiceOptions {
  kbs: KbEntry[];
  /** 한 호출 제한 시간 */
  callTimeoutMs?: number;
  budget?: KbToolBudget;
  /**
   * 지식 루트(<root>/<kbId>/index.sqlite). 있으면 searchKnowledge가 읽기 전용 색인을 먼저 쓰고,
   * 색인이 없거나 맞지 않으면 키워드 스캔으로 내려간다. 없으면 항상 스캔.
   * 색인은 문서형 KB에만 쓴다 (코드베이스 KB는 색인에 넣지 않는다).
   */
  root?: string;
}

/** 시간 제한을 건다 (Promise가 끝나지 않으면 cancelled). 제한 시간이 지나면 신호로 진행 중 스캔을 멈춘다 */
function withTimeout<T>(p: Promise<T>, ms: number, ac: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new KbToolError('cancelled', 'knowledge tool call timed out'));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** 코드베이스 KB 여부: 색인 정책이 아니라 탐색 방식(agentic)으로 판단한다 */
function isAgentic(k: KbEntry): boolean {
  return searchPolicyOf(k.kind).method === 'agentic';
}

/**
 * 읽기 전용 KB 도구. 모든 입력은 core 파서로 검증하고,
 * 파일 접근은 KB 루트 밖으로 나가지 못하게 realpath로 확인한다.
 * 코드베이스 KB는 색인·벡터 없이 실제 파일을 직접 읽는다.
 */
export class KbToolService {
  private readonly byId: Map<string, KbEntry>;
  private readonly callTimeoutMs: number;
  private readonly root: string | undefined;
  readonly budget: KbToolBudget;

  constructor(opts: KbToolServiceOptions) {
    this.byId = new Map(opts.kbs.map((k) => [k.kbId, k]));
    this.callTimeoutMs = opts.callTimeoutMs ?? 10_000;
    this.root = opts.root;
    this.budget = opts.budget ?? new KbToolBudget();
  }

  get allowedIds(): string[] {
    return [...this.byId.keys()];
  }

  /** 도구 호출. 실패는 isError 결과로 돌려주고 예외를 던지지 않는다 */
  async call(name: string, args: unknown): Promise<KbToolResult> {
    try {
      if (!(KB_TOOL_NAMES as readonly string[]).includes(name)) {
        throw new KbToolError('bad_input', `unknown tool: ${name}`);
      }
      this.budget.take();
      const ac = new AbortController();
      const out = await withTimeout(this.dispatch(name as KbToolName, args, ac.signal), this.callTimeoutMs, ac);
      const text = JSON.stringify(out, null, 2);
      this.budget.spend(text.length);
      return { text, isError: false };
    } catch (e) {
      if (e instanceof KbToolError) return { text: JSON.stringify({ error: e.code, message: e.message }), isError: true };
      if (e instanceof CodebaseAbortError) return { text: JSON.stringify({ error: 'cancelled', message: 'knowledge tool call timed out' }), isError: true };
      return { text: JSON.stringify({ error: 'internal', message: 'knowledge tool failed' }), isError: true };
    }
  }

  private kb(kbId: string): KbEntry {
    const k = this.byId.get(kbId);
    if (!k) throw new KbToolError('kb_not_allowed', `knowledge base not allowed: ${kbId}`);
    return k;
  }

  /** 탐색 대상 (연결 폴더가 없어졌으면 not_found) */
  private target(k: KbEntry): CodebaseTarget {
    if (k.missing) throw new KbToolError('not_found', `linked folder is missing: ${k.kbId}`);
    return { kbId: k.kbId, kbName: k.kbName, root: k.filesRoot, excludes: k.excludes ?? [] };
  }

  private async dispatch(name: KbToolName, args: unknown, signal: AbortSignal): Promise<unknown> {
    switch (name) {
      case 'searchKnowledge': {
        const input = parseSearchKnowledgeInput(args, this.allowedIds);
        const selected = input.kbIds.map((id) => this.kb(id));
        const agentic = selected.filter(isAgentic);
        const documents = selected.filter((k) => !isAgentic(k));
        const fromIndex = this.root && documents.length
          ? await indexedSearch(this.root, documents.map((k) => k.kbId), { ...input, signal })
          : { results: [], folders: [], fallbackKbIds: documents.map((k) => k.kbId) };
        const scanIds = new Set(fromIndex.fallbackKbIds);
        const scanKbs: SearchKb[] = documents.filter((k) => scanIds.has(k.kbId));
        const scan = scanKbs.length
          ? await keywordSearch(scanKbs, input.query, {
              limit: input.limit,
              signal,
              ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}),
            })
          : { results: [], skipped: [] };
        // 코드베이스 KB: 실제 파일을 훑는다 (색인·벡터 없음)
        const skipped = [...scan.skipped];
        const live: KbSearchItem[] = [];
        for (const k of agentic) {
          if (k.missing) {
            skipped.push({ kbId: k.kbId, reason: 'linked folder is missing' });
            continue;
          }
          const hits = await searchCodebase(this.target(k), input.query, {
            limit: input.limit,
            signal,
            ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}),
          });
          for (const h of hits) {
            live.push({
              kbId: k.kbId,
              kbName: k.kbName,
              path: h.path,
              title: h.path,
              ...(h.symbol ? { heading: h.symbol } : {}),
              startLine: h.lineStart,
              endLine: h.lineEnd,
              score: h.score,
              snippet: h.text,
            });
          }
        }
        live.sort((a, b) => b.score - a.score);
        // 폴더 후보: 색인 폴더 채널이 있으면 그것을, 없으면 문서형 KB의 meta/folders.json을 질의로 맞춘다
        const indexFolders = fromIndex.folders.filter((f) => inPathPrefix(f.path, input.pathPrefix));
        const folders = indexFolders.length
          ? indexFolders
          : folderHintsFromMeta(documents, input.query, input.pathPrefix, FOLDER_HINT_MAX);
        const out: SearchKnowledgeOutput = {
          results: mergeFairly([...fromIndex.results, ...scan.results], live, input.limit),
          folders,
          skipped,
        };
        return out;
      }
      case 'listKnowledgeDirectory': {
        const input = parseListDirectoryInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
        if (isAgentic(k)) {
          const t = this.target(k);
          const page = await listDir(k.filesRoot, input.path, input.offset, entryFilterFor(t));
          const out: ListKnowledgeDirectoryOutput = {
            kbId: k.kbId,
            path: input.path,
            entries: page.entries,
            ...(page.nextOffset !== undefined ? { nextCursor: String(page.nextOffset) } : {}),
          };
          return out;
        }
        const page = await listDir(k.filesRoot, input.path, input.offset);
        const summary = folderMetaOf(k.filesRoot, input.path)?.description;
        const out: ListKnowledgeDirectoryOutput = {
          kbId: k.kbId,
          path: input.path,
          entries: page.entries,
          ...(page.nextOffset !== undefined ? { nextCursor: String(page.nextOffset) } : {}),
          ...(summary ? { summary } : {}),
        };
        return out;
      }
      case 'readKnowledgeFile': {
        const input = parseReadFileInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
        if (isAgentic(k)) {
          const r = await readCodebaseRange(this.target(k), input.path, { startLine: input.startLine, endLine: input.endLine, signal });
          const out: ReadKnowledgeFileOutput = {
            kbId: k.kbId,
            path: input.path,
            startLine: r.startLine,
            endLine: r.endLine,
            totalLines: r.totalLines,
            content: r.content,
            truncated: r.truncated,
          };
          return out;
        }
        const { lines } = await readText(k.filesRoot, input.path);
        const total = lines.length;
        let end = Math.min(input.endLine, total);
        let content = '';
        // 파일에 이 범위 밖 줄이 더 있으면 잘린 것 (입력 endLine은 파서가 이미 readMaxLines로 자른 값)
        let truncated = end < total;
        const picked = lines.slice(input.startLine - 1, end);
        for (let i = 0; i < picked.length; i++) {
          const piece = (i ? '\n' : '') + picked[i];
          if (content.length + piece.length > KB_TOOL_LIMITS.readMaxChars) {
            end = input.startLine - 1 + i;
            truncated = true;
            break;
          }
          content += piece;
        }
        const out: ReadKnowledgeFileOutput = {
          kbId: k.kbId,
          path: input.path,
          startLine: input.startLine,
          endLine: Math.max(input.startLine - 1, end),
          totalLines: total,
          content,
          truncated,
        };
        return out;
      }
      case 'getKnowledgeOutline': {
        const input = parseOutlineInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
        if (isAgentic(k)) {
          const t = this.target(k);
          const target = await resolveInside(k.filesRoot, input.path);
          if (target.isDir) {
            const page = await listDir(k.filesRoot, input.path, 0, entryFilterFor(t));
            const items: KbOutlineItem[] = page.entries.map((e) => ({
              kind: e.type === 'directory' ? ('directory' as const) : ('file' as const),
              name: e.name,
              path: e.path,
            }));
            const cap = KB_TOOL_LIMITS.outlineMaxItems;
            const out: GetKnowledgeOutlineOutput = {
              kbId: k.kbId,
              path: input.path,
              type: 'directory',
              items: items.slice(0, cap),
              truncated: items.length > cap || page.nextOffset !== undefined,
            };
            return out;
          }
          const lines = await readCodebaseLines(t, input.path, signal);
          const o = outlineOfLines(lines, isMarkdownPath(input.path));
          const out: GetKnowledgeOutlineOutput = { kbId: k.kbId, path: input.path, type: 'file', items: o.items, truncated: o.truncated };
          return out;
        }
        const target = await resolveInside(k.filesRoot, input.path);
        if (target.isDir) {
          const page = await listDir(k.filesRoot, input.path, 0);
          const meta = folderMetaOf(k.filesRoot, input.path);
          // 주요 문서(meta keyDocs)는 실제로 files/ 안에 있는 파일만 낸다 (메타가 낡았을 수 있다)
          const keyDocs: KbOutlineItem[] = [];
          for (const d of meta?.keyDocs ?? []) {
            try {
              const t = await resolveInside(k.filesRoot, d.path);
              if (!t.isDir) keyDocs.push({ kind: 'file', name: d.title || d.path, path: d.path });
            } catch {
              /* 없어진 문서는 건너뛴다 */
            }
          }
          const seen = new Set(keyDocs.map((i) => i.path));
          const listed: KbOutlineItem[] = page.entries
            .filter((e) => !seen.has(e.path))
            .map((e) => ({ kind: e.type === 'directory' ? ('directory' as const) : ('file' as const), name: e.name, path: e.path }));
          const items = [...keyDocs, ...listed];
          const cap = KB_TOOL_LIMITS.outlineMaxItems;
          const out: GetKnowledgeOutlineOutput = {
            kbId: k.kbId,
            path: input.path,
            type: 'directory',
            items: items.slice(0, cap),
            truncated: items.length > cap || page.nextOffset !== undefined,
            ...(meta?.description ? { description: meta.description } : {}),
          };
          return out;
        }
        const { lines } = await readText(k.filesRoot, input.path);
        const o = outlineOfLines(lines, isMarkdownPath(input.path));
        const out: GetKnowledgeOutlineOutput = { kbId: k.kbId, path: input.path, type: 'file', items: o.items, truncated: o.truncated };
        return out;
      }
      case 'findFiles': {
        const input = parseFindFilesInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
        const found = await findFiles(this.target(k), input.pattern, { limit: input.limit + 1, signal });
        const out: FindFilesOutput = {
          kbId: k.kbId,
          pattern: input.pattern,
          paths: found.slice(0, input.limit),
          truncated: found.length > input.limit,
        };
        return out;
      }
      case 'grepKnowledge': {
        const input = parseGrepInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
        const stats: ScanStats = { scannedFiles: 0, timedOutFiles: 0, byteBudgetHit: false };
        const found = await grep(this.target(k), input.pattern, {
          regex: input.regex,
          limit: input.limit + 1,
          signal,
          stats,
          ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}),
        });
        const notes: string[] = [];
        if (stats.timedOutFiles > 0) notes.push(`${stats.timedOutFiles} file(s) were only partly scanned (time budget per file).`);
        if (stats.byteBudgetHit) notes.push('Scan stopped at the total byte budget. Narrow with pathPrefix to cover the rest.');
        const out: GrepKnowledgeOutput = {
          kbId: k.kbId,
          pattern: input.pattern,
          regex: input.regex,
          hits: found.slice(0, input.limit),
          truncated: found.length > input.limit,
          scannedFiles: stats.scannedFiles,
          notes,
        };
        return out;
      }
      case 'findDefinitions': {
        const input = parseFindDefinitionsInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
        const found = await findDefinitions(this.target(k), input.symbol, { limit: input.limit + 1, signal });
        const out: FindDefinitionsOutput = {
          kbId: k.kbId,
          symbol: input.symbol,
          hits: found.slice(0, input.limit),
          truncated: found.length > input.limit,
        };
        return out;
      }
    }
  }
}
