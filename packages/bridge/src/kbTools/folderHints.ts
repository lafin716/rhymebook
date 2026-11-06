import path from 'node:path';
import { matchFolders, rewriteQuery, type FolderHint, type FolderMeta, type QueryPlan } from '@branch/core';
import { readFolderMeta } from '../rag/folderMeta';

/** 폴더 후보 상한 (검색 응답 크기 제한) */
export const FOLDER_HINT_MAX = 8;

/** 검색 질의 한 번을 QueryPlan으로 만든다 (대화 맥락 없음, 키워드 중심) */
export function planFor(question: string): QueryPlan {
  return rewriteQuery({
    question,
    parentTitles: [],
    parentSummaries: [],
    recentUser: [],
    recentAssistant: [],
    kbNames: [],
  });
}

/**
 * KB의 meta/folders.json 폴더 목록. <kbDir>/meta/ 는 files/ 밖에 있으므로(kbDir = files/의 부모) 도구로는 닿지 않는다.
 * 없거나 깨졌거나 버전이 다르면 undefined (호출자는 메타 없이 동작한다).
 */
export function foldersOf(filesRoot: string): FolderMeta[] | undefined {
  return readFolderMeta(path.dirname(filesRoot))?.folders;
}

/** 특정 폴더의 메타. 루트는 '' */
export function folderMetaOf(filesRoot: string, folder: string): FolderMeta | undefined {
  return foldersOf(filesRoot)?.find((f) => f.path === folder);
}

/**
 * 경로 접두사 필터 (세그먼트 단위). 'docs'는 'docs'와 'docs/...'만 맞고 'docs2'는 맞지 않는다.
 * 접두사가 없으면 모두 맞다.
 */
export function inPathPrefix(p: string, prefix: string | undefined): boolean {
  if (!prefix) return true;
  const pre = prefix.replace(/\/+$/, '');
  return p === pre || p.startsWith(pre + '/');
}

/** 메타가 있는 KB들에서 질의에 맞는 폴더 후보를 모은다 (색인 폴더 채널이 비었을 때의 대체) */
export function folderHintsFromMeta(
  kbs: { kbId: string; filesRoot: string }[],
  question: string,
  pathPrefix: string | undefined,
  limit = FOLDER_HINT_MAX,
): { kbId: string; path: string; title: string }[] {
  const plan = planFor(question);
  const hints: FolderHint[] = [];
  for (const k of kbs) {
    const folders = foldersOf(k.filesRoot);
    if (!folders) continue;
    hints.push(...matchFolders(folders.filter((f) => inPathPrefix(f.path, pathPrefix)), plan, k.kbId, limit));
  }
  return hints
    .sort((a, b) => b.score - a.score || (a.kbId < b.kbId ? -1 : a.kbId > b.kbId ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit)
    .map((h) => ({ kbId: h.kbId, path: h.path, title: h.title }));
}
