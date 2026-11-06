import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { cleanExcludes, isKnowledgeId, isKnowledgeKind, KnowledgePolicyError, type KnowledgeKind } from '@branch/core';

/**
 * meta.json 읽기 전용 공용 도우미 (ADR-127·128). 색인기·검색·MCP 서버가 같은 규칙으로
 * KB 유형과 원본 위치를 판단하게 한다. 쓰기는 knowledgeStore만 한다.
 *
 * 판단 규칙 (fail closed):
 * - meta.json이 있고 파싱되며 kind가 없으면 → 미분류(undefined) = 문서형 동작 유지 (레거시)
 * - meta.json이 없거나, 파싱되지 않거나, kind 값이 알 수 없으면 → 'unreadable'. 색인·벡터 경로는 모두 막는다.
 */
export interface KbMetaView {
  id: string;
  name: string;
  /** undefined = 미분류 (문서형 동작 유지) */
  kind?: KnowledgeKind;
  /** 코드베이스 연결 폴더 (절대 경로) */
  linkedPath?: string;
  excludes: string[];
}

export type KbMetaFailure = 'missing' | 'unparseable' | 'invalid_kind';

export type KbMetaResult = { ok: true; view: KbMetaView } | { ok: false; reason: KbMetaFailure };

/** 정책 판단용 유형: 확정 유형 · 미분류 · 판단 불가(unreadable) */
export type KindForPolicy = KnowledgeKind | undefined | 'unreadable';

/**
 * meta.json의 kind 필드 해석 (store와 색인기가 같은 규칙을 쓴다).
 * 키가 없으면 undefined(레거시 미분류), 알 수 없는 값(null 포함)이면 'invalid'
 */
export function parseKindField(v: unknown): KnowledgeKind | undefined | 'invalid' {
  if (v === undefined) return undefined;
  return isKnowledgeKind(v) ? v : 'invalid';
}

/** meta.json을 엄격하게 읽는다. 실패 사유를 돌려준다 (id 형식이 틀리면 unparseable) */
export function readKbMetaResult(root: string, id: string): KbMetaResult {
  if (!isKnowledgeId(id)) return { ok: false, reason: 'unparseable' };
  let text: string;
  try {
    text = readFileSync(path.join(root, id, 'meta.json'), 'utf8');
  } catch {
    return { ok: false, reason: 'missing' };
  }
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'unparseable' };
    raw = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  const kind = parseKindField(raw.kind);
  if (kind === 'invalid') return { ok: false, reason: 'invalid_kind' };
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : id;
  const linkedPath =
    kind === 'codebase' && typeof raw.linkedPath === 'string' && path.isAbsolute(raw.linkedPath) ? raw.linkedPath : undefined;
  return {
    ok: true,
    view: { id, name, ...(kind ? { kind } : {}), ...(linkedPath ? { linkedPath } : {}), excludes: cleanExcludes(raw.excludes) },
  };
}

/** meta.json을 읽는다. 없거나 깨졌거나 kind가 틀렸으면 undefined (표시·도구용. 정책 판단에는 policyKindOf를 쓴다) */
export function readKbMeta(root: string, id: string): KbMetaView | undefined {
  const r = readKbMetaResult(root, id);
  return r.ok ? r.view : undefined;
}

/** KB 유형 (표시·도구용). 메타가 없거나 깨졌으면 undefined — 정책 판단에 쓰지 않는다 */
export function kindOfKb(root: string, id: string): KnowledgeKind | undefined {
  return readKbMeta(root, id)?.kind;
}

/** 정책 판단용 유형. 읽을 수 없으면 'unreadable' (색인·벡터 경로는 이 값을 막아야 한다) */
export function policyKindOf(root: string, id: string): KindForPolicy {
  const r = readKbMetaResult(root, id);
  if (!r.ok) return 'unreadable';
  return r.view.kind;
}

/** 정책 판단용 유형을 throw 형식으로. 읽을 수 없으면 KnowledgePolicyError('kb_meta_unreadable') */
export function assertReadableKind(root: string, id: string): KnowledgeKind | undefined {
  const kind = policyKindOf(root, id);
  if (kind === 'unreadable') {
    throw new KnowledgePolicyError('kb_meta_unreadable', `knowledge base ${id} has an unreadable meta.json`);
  }
  return kind;
}

/**
 * 원본 파일 루트. 연결 폴더 코드베이스는 그 폴더(realpath), 아니면 `<root>/<id>/files`.
 * 연결 폴더가 사라졌으면 undefined (호출 쪽이 codebase_missing으로 알린다).
 */
export function filesRootOf(root: string, id: string, meta: KbMetaView | undefined = readKbMeta(root, id)): string | undefined {
  if (meta?.linkedPath) {
    try {
      const real = realpathSync(meta.linkedPath);
      return statSync(real).isDirectory() ? real : undefined;
    } catch {
      return undefined;
    }
  }
  const dir = path.join(root, id, 'files');
  return existsSync(dir) ? dir : path.join(root, id, 'files');
}
