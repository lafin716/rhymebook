// 지식베이스 IPC의 인자 검증·정책 가드 (ADR-127~130). Electron에 의존하지 않는 순수 모듈이라 단위 테스트한다.
// 렌더러 입력은 여기서 다시 확인한다. 코드베이스 정책 위반은 store·큐에 닿기 전에 KnowledgePolicyError로 막는다.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  KnowledgePolicyError,
  cleanExcludes,
  isKnowledgeId,
  isKnowledgeKind,
  isKnowledgePath,
  searchPolicyOf,
  type KnowledgeCreateOptions,
  type KnowledgeKind,
} from '@branch/core';

/** 허용되는 가드 실패 코드. 렌더러는 Error 메시지의 `code:` 접두로 구분한다 */
export const KB_GUARD_PREFIX = 'kb-guard:';

/** 정책 오류를 IPC로 보낼 수 있는 메시지로 바꾼다. 형식: `kb-guard:<code>: <개발자용 설명>` */
export function guardMessage(err: KnowledgePolicyError): string {
  return `${KB_GUARD_PREFIX}${err.code}: ${err.message}`;
}

export class KbArgError extends Error {
  constructor(readonly field: string) {
    super(`kb-arg:${field}`);
    this.name = 'KbArgError';
  }
}

export function kbIdArg(v: unknown): string {
  if (!isKnowledgeId(v)) throw new KbArgError('id');
  return v;
}

export function kbKindArg(v: unknown): KnowledgeKind {
  if (!isKnowledgeKind(v)) throw new KbArgError('kind');
  return v;
}

export function kbRelPathArg(v: unknown, field = 'path'): string {
  if (!isKnowledgePath(v)) throw new KbArgError(field);
  return v;
}

export function kbDescriptionArg(v: unknown): string {
  if (typeof v !== 'string' || v.length > 500) throw new KbArgError('description');
  return v.trim();
}

/** 제외 패턴 배열. 배열이 아니면 거부, 항목은 cleanExcludes로 정리한다 */
export function kbExcludesArg(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 1000) throw new KbArgError('excludes');
  return cleanExcludes(v);
}

/** 재색인 옵션. full·retryFailed는 boolean, paths는 files/ 기준 상대 경로 최대 500개 */
export function kbReindexOptsArg(v: unknown): { full: boolean; paths?: string[]; retryFailed: boolean } {
  if (v === undefined || v === null) return { full: false, retryFailed: false };
  if (typeof v !== 'object' || Array.isArray(v)) throw new KbArgError('reindex');
  const o = v as Record<string, unknown>;
  if (o.full !== undefined && typeof o.full !== 'boolean') throw new KbArgError('reindex.full');
  if (o.retryFailed !== undefined && typeof o.retryFailed !== 'boolean') throw new KbArgError('reindex.retryFailed');
  let paths: string[] | undefined;
  if (o.paths !== undefined) {
    if (!Array.isArray(o.paths) || o.paths.length > 500) throw new KbArgError('reindex.paths');
    paths = o.paths.map((p) => kbRelPathArg(p, 'reindex.paths'));
  }
  return { full: o.full === true, ...(paths ? { paths } : {}), retryFailed: o.retryFailed === true };
}

/** 새 지식베이스 옵션. linkedPath는 여기서 형식만 본다. 실제 폴더 확인은 resolveLinkedDir가 한다 */
export function kbCreateOptsArg(v: unknown): KnowledgeCreateOptions {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new KbArgError('create');
  const o = v as Record<string, unknown>;
  const out: KnowledgeCreateOptions = {};
  if (o.kind !== undefined) out.kind = kbKindArg(o.kind);
  if (o.description !== undefined) out.description = kbDescriptionArg(o.description);
  if (o.linkedPath !== undefined) {
    if (typeof o.linkedPath !== 'string' || !o.linkedPath || o.linkedPath.length > 4096 || o.linkedPath.includes('\0')) {
      throw new KbArgError('linkedPath');
    }
    if (!path.isAbsolute(o.linkedPath)) throw new KbArgError('linkedPath');
    out.linkedPath = o.linkedPath;
  }
  if (o.excludes !== undefined) out.excludes = kbExcludesArg(o.excludes);
  if (out.linkedPath && out.kind !== 'codebase') throw new KbArgError('linkedPath');
  return out;
}

/**
 * 연결 폴더 확인: 절대 경로 → realpath → 디렉터리인지. 루트·홈·지식 폴더 겹침 등은 bridge의 validateLinkedFolder가 맡는다.
 * 여기서는 실제 경로를 돌려주는 것까지만 한다 (테스트에서는 fs를 주입한다).
 */
export async function resolveLinkedDir(raw: string, fsImpl: Pick<typeof fs, 'realpath' | 'stat'> = fs): Promise<string> {
  if (!path.isAbsolute(raw) || raw.includes('\0')) throw new KbArgError('linkedPath');
  let real: string;
  try {
    real = await fsImpl.realpath(raw);
  } catch {
    throw new KbArgError('linkedPath');
  }
  const st = await fsImpl.stat(real).catch(() => null);
  if (!st || !st.isDirectory()) throw new KbArgError('linkedPath');
  return real;
}

/** 코드베이스면 index 설정 변경을 막는다 (ADR-127). 설정 저장 전에 부른다 */
export function assertIndexSettingsAllowed(kbId: string, kind: KnowledgeKind | undefined): void {
  if (!searchPolicyOf(kind).indexAllowed) {
    throw new KnowledgePolicyError('codebase_index_forbidden', `index settings cannot change for codebase knowledge base ${kbId}`);
  }
}

/** 재색인·색인 큐 작업 전에 부른다. 코드베이스면 throw (full·paths·retryFailed 모두) */
export function assertReindexAllowed(kbId: string, kind: KnowledgeKind | undefined): void {
  if (!searchPolicyOf(kind).indexAllowed) {
    throw new KnowledgePolicyError('codebase_index_forbidden', `reindex is not allowed for codebase knowledge base ${kbId}`);
  }
}

/** 임베딩·벡터 관련 작업 (무결성 검사·백업 복구 포함) 전에 부른다 */
export function assertVectorOpAllowed(kbId: string, kind: KnowledgeKind | undefined): void {
  if (!searchPolicyOf(kind).vectorAllowed) {
    throw new KnowledgePolicyError('codebase_index_forbidden', `vector operation is not allowed for codebase knowledge base ${kbId}`);
  }
}

/** 연결 폴더 코드베이스는 문서형으로 바꿀 수 없다 (ADR-128) */
export function assertKindChangeAllowed(kbId: string, current: { kind?: KnowledgeKind; linkedPath?: string } | undefined, to: KnowledgeKind): void {
  if (current?.kind === 'codebase' && current.linkedPath && to === 'document') {
    throw new KnowledgePolicyError('linked_kind_locked', `linked codebase ${kbId} cannot become a document knowledge base`);
  }
}
