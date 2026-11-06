import { KB_TOOL_LIMITS, KB_TOOL_NAMES, KbToolBudget, KbToolError, parseListDirectoryInput, parseOutlineInput, parseReadFileInput, parseSearchKnowledgeInput, type GetKnowledgeOutlineOutput, type KbOutlineItem, type KbToolName, type ListKnowledgeDirectoryOutput, type ReadKnowledgeFileOutput, type SearchKnowledgeOutput } from '@branch/core';
import { listDir, outlineOfLines, readText, resolveInside, isMarkdownPath } from './files';
import { indexedSearch } from './indexSearch';
import { FOLDER_HINT_MAX, folderHintsFromMeta, folderMetaOf, inPathPrefix } from './folderHints';
import { keywordSearch, type SearchKb } from './search';

export interface KbEntry {
  kbId: string;
  kbName: string;
  /** <root>/<kbId>/files — 이 아래만 읽는다 */
  filesRoot: string;
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
   */
  root?: string;
}

/** 시간 제한을 건다 (Promise가 끝나지 않으면 cancelled) */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new KbToolError('cancelled', 'knowledge tool call timed out')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 네 개의 읽기 전용 KB 도구. 모든 입력은 core 파서로 검증하고,
 * 파일 접근은 files/ 밖으로 나가지 못하게 realpath로 확인한다.
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
      const out = await withTimeout(this.dispatch(name as KbToolName, args), this.callTimeoutMs);
      const text = JSON.stringify(out, null, 2);
      this.budget.spend(text.length);
      return { text, isError: false };
    } catch (e) {
      if (e instanceof KbToolError) return { text: JSON.stringify({ error: e.code, message: e.message }), isError: true };
      return { text: JSON.stringify({ error: 'internal', message: 'knowledge tool failed' }), isError: true };
    }
  }

  private kb(kbId: string): KbEntry {
    const k = this.byId.get(kbId);
    if (!k) throw new KbToolError('kb_not_allowed', `knowledge base not allowed: ${kbId}`);
    return k;
  }

  private async dispatch(name: KbToolName, args: unknown): Promise<unknown> {
    switch (name) {
      case 'searchKnowledge': {
        const input = parseSearchKnowledgeInput(args, this.allowedIds);
        const kbs: SearchKb[] = input.kbIds.map((id) => this.kb(id));
        const fromIndex = this.root
          ? await indexedSearch(this.root, input.kbIds, input)
          : { results: [], folders: [], fallbackKbIds: input.kbIds };
        const scanIds = new Set(fromIndex.fallbackKbIds);
        const scanKbs = kbs.filter((k) => scanIds.has(k.kbId));
        const scan = scanKbs.length
          ? await keywordSearch(scanKbs, input.query, { limit: input.limit, ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}) })
          : { results: [], skipped: [] };
        // 폴더 후보: 색인 폴더 채널이 있으면 그것을, 없으면 meta/folders.json을 질의로 맞춘다 (둘 다 없으면 빈 배열)
        const indexFolders = fromIndex.folders.filter((f) => inPathPrefix(f.path, input.pathPrefix));
        const folders = indexFolders.length
          ? indexFolders
          : folderHintsFromMeta(kbs, input.query, input.pathPrefix, FOLDER_HINT_MAX);
        const out: SearchKnowledgeOutput = {
          results: [...fromIndex.results, ...scan.results].slice(0, input.limit),
          folders,
          skipped: scan.skipped,
        };
        return out;
      }
      case 'listKnowledgeDirectory': {
        const input = parseListDirectoryInput(args, this.allowedIds);
        const k = this.kb(input.kbId);
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
    }
  }
}
