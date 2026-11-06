import path from 'node:path';
import { createNoneEmbedder, DEFAULT_RAG_SETTINGS, KB_TOOL_LIMITS, KbToolError, type Evidence, type KbSearchItem } from '@branch/core';
import { planFor } from './folderHints';
import { createKnowledgeIndexer, INDEX_FILE } from '../rag/indexer';
import { IndexRepository } from '../rag/sqliteRepository';

/** 폴더 후보 상한 (검색 응답 크기 제한) */
const FOLDER_MAX = 8;

export interface IndexedSearchInput {
  query: string;
  limit: number;
  pathPrefix?: string;
  /** 취소 신호. 시작 전·검색 후에 확인한다 (cancelled) */
  signal?: AbortSignal;
}

export interface IndexedSearchOutput {
  results: KbSearchItem[];
  folders: { kbId: string; path: string; title: string }[];
  /** 색인으로 답하지 못해 키워드 스캔으로 넘길 KB (색인 없음·스키마 오래됨·문서 0개·검색 오류) */
  fallbackKbIds: string[];
}

/**
 * 색인을 읽기 전용으로 열 수 있고 문서가 있는가. 파일이 없거나, 스키마가 맞지 않거나(IndexSchemaError),
 * 청크가 0개면 false. 열면 바로 닫는다 (쓰지 않음, 키 없음).
 */
export function indexUsable(root: string, kbId: string): boolean {
  let repo: IndexRepository | undefined;
  try {
    repo = IndexRepository.openReadOnly(path.join(root, kbId, INDEX_FILE));
    return repo.stats().leafCount > 0;
  } catch {
    return false;
  } finally {
    repo?.close();
  }
}

function toItem(e: Evidence): KbSearchItem {
  return {
    kbId: e.kbId,
    kbName: e.kbName,
    path: e.path,
    title: e.title,
    ...(e.headingPath.length ? { heading: e.headingPath.join(' > ') } : {}),
    ...(e.lineStart !== undefined ? { startLine: e.lineStart } : {}),
    ...(e.lineEnd !== undefined ? { endLine: e.lineEnd } : {}),
    score: e.score,
    snippet: e.text.slice(0, KB_TOOL_LIMITS.searchSnippetChars),
  };
}

/**
 * 읽기 전용 색인으로 FTS5·심볼·경로·폴더 채널을 검색한다. 벡터와 API 키는 쓰지 않는다
 * (임베딩 공급자는 항상 'none'으로 고정하고 키 공급자는 undefined를 돌려준다).
 * 색인을 쓰지 않는 KB와 실패한 KB는 fallbackKbIds로 돌려주어 호출 쪽이 키워드 스캔을 하게 한다.
 */
export async function indexedSearch(root: string, kbIds: string[], input: IndexedSearchInput): Promise<IndexedSearchOutput> {
  if (input.signal?.aborted) throw new KbToolError('cancelled', 'search cancelled');
  const usable = kbIds.filter((id) => indexUsable(root, id));
  const unusable = kbIds.filter((id) => !usable.includes(id));
  if (usable.length === 0) return { results: [], folders: [], fallbackKbIds: unusable };

  const indexer = createKnowledgeIndexer({
    root,
    getOpenAIKey: () => undefined,
    readOnly: true,
    embedderFor: () => createNoneEmbedder(),
  });
  try {
    const plan = planFor(input.query);
    const r = await indexer.retrieve({
      kbIds: usable,
      plan,
      settings: { ...DEFAULT_RAG_SETTINGS, topK: input.limit },
      ...(input.pathPrefix ? { filter: { pathPrefix: input.pathPrefix } } : {}),
    });
    if (input.signal?.aborted) throw new KbToolError('cancelled', 'search cancelled');
    const failed = new Set(r.skipped.map((s) => s.kbId));
    return {
      results: r.evidence.filter((e) => !failed.has(e.kbId)).map(toItem).slice(0, input.limit),
      folders: (r.folders ?? [])
        .filter((f) => !failed.has(f.kbId))
        .slice(0, FOLDER_MAX)
        .map((f) => ({ kbId: f.kbId, path: f.path, title: f.title })),
      fallbackKbIds: [...unusable, ...usable.filter((id) => failed.has(id))],
    };
  } catch {
    // 색인 오류(IndexSchemaError 등)는 조용히 스캔으로 넘긴다
    return { results: [], folders: [], fallbackKbIds: kbIds };
  } finally {
    await indexer.close().catch(() => undefined);
  }
}
