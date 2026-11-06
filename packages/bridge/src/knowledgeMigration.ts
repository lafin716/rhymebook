import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { classifyLegacyKnowledge, isKnowledgeId, type KnowledgeBase, type KnowledgeKind } from '@branch/core';
import type { KbMigrationRecord, KnowledgeStore } from './knowledgeStore';
import { hasIndexFiles } from './knowledgeBackup';

/**
 * 지식베이스 유형 마이그레이션 (ADR-132). 앱 시작 때 한 번 돌고, 다시 돌아도 바뀌는 것이 없다(멱등).
 * - 유형이 없는 KB: 확실한 것만 유형을 기록(migratedFrom 표시). 불확실하면 그대로 두고 추정만 남긴다(미분류 = 문서형 동작).
 * - 코드베이스로 확정된 KB의 색인 파일(index*.sqlite)은 삭제하지 않고 backup/<ts>/로 옮긴다.
 * - 원본(files/, 연결 폴더)과 세션(knowledgeIds)은 건드리지 않는다.
 * 완료 표식은 <root>/.kb-migration.json. 오류가 하나라도 있으면 표식을 남기지 않아 다음 시작 때 다시 시도한다.
 */

export const KB_MIGRATION_VERSION = 'kb-types-1';
export const KB_MIGRATION_MARKER = '.kb-migration.json';
/** 유형 판단에 쓰는 파일 경로 표본 최대 개수 */
const FACT_PATH_SAMPLE = 500;

export type KbMigrationAction = 'classified' | 'suggested' | 'backed_up' | 'unchanged' | 'error';

export interface KbMigrationEntry {
  id: string;
  action: KbMigrationAction;
  kind?: KnowledgeKind;
  /** 판단 근거 코드 (로그·UI용, 비밀 값 아님) */
  reason?: string;
}

export interface KbMigrationReport {
  version: string;
  /** 이번 실행에서 표식을 새로 썼는가 */
  markerWritten: boolean;
  /** 표식이 이미 같은 버전으로 있었는가 */
  alreadyMigrated: boolean;
  scanned: number;
  classified: number;
  suggested: number;
  backedUp: number;
  unchanged: number;
  errors: number;
  /** list()가 건너뛴 KB 폴더 수 (meta.json 없음·깨짐·알 수 없는 kind). 이 값이 있으면 표식을 쓰지 않아 다음 시작에 다시 시도한다 */
  skippedUnreadable: number;
  entries: KbMigrationEntry[];
}

export interface KbMigrationMarker {
  version: string;
  completedAt: number;
}

export interface RunKnowledgeMigrationOptions {
  /** 지식 루트 (`<userData>/knowledge`) */
  root: string;
  store: Pick<KnowledgeStore, 'list' | 'sources' | 'tree' | 'setKind' | 'setKindSuggestion'>;
  /** 있으면 색인 작업을 먼저 멈춘다 (store.releaseIndex를 쓰지 않는 호출자용) */
  indexer?: { release(kbId: string): Promise<void> };
  now?: () => number;
  /** 개수만 기록하는 로그 (KB 이름·경로·비밀 값은 넘기지 않는다) */
  log?: (msg: string) => void;
}

function readMarker(root: string): KbMigrationMarker | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, KB_MIGRATION_MARKER), 'utf8')) as Partial<KbMigrationMarker>;
    if (typeof raw.version !== 'string') return undefined;
    return { version: raw.version, completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : 0 };
  } catch {
    return undefined;
  }
}

function writeMarker(root: string, marker: KbMigrationMarker): void {
  const file = path.join(root, KB_MIGRATION_MARKER);
  mkdirSync(root, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(marker, null, 2));
  renameSync(tmp, file);
}

/** files/ 기준 파일 경로 표본. 디렉터리 항목은 빼고 개수를 제한한다 */
async function fileSample(store: RunKnowledgeMigrationOptions['store'], id: string): Promise<string[]> {
  const entries = await store.tree(id);
  const out: string[] = [];
  for (const e of entries) {
    if (e.dir) continue;
    out.push(e.path);
    if (out.length >= FACT_PATH_SAMPLE) break;
  }
  return out;
}

/**
 * 시작 시 호출하는 마이그레이션. 표식이 같은 버전으로 있으면 바로 돌아간다(멱등).
 * 표식이 없을 때만 KB를 훑는다. 훑은 뒤 결과가 깨끗하면 표식을 쓴다.
 */
/** KB 형식 이름의 폴더 중 목록에 없는 것의 수 (읽을 수 없는 KB) */
function countUnlistedKbDirs(root: string, listed: Set<string>): number {
  let names: { name: string; isDir: boolean }[];
  try {
    names = readdirSync(root, { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch {
    return 0;
  }
  return names.filter((d) => d.isDir && isKnowledgeId(d.name) && !listed.has(d.name)).length;
}

export async function runKnowledgeMigration(opts: RunKnowledgeMigrationOptions): Promise<KbMigrationReport> {
  const { root, store } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const report: KbMigrationReport = {
    version: KB_MIGRATION_VERSION,
    markerWritten: false,
    alreadyMigrated: false,
    scanned: 0,
    classified: 0,
    suggested: 0,
    backedUp: 0,
    unchanged: 0,
    errors: 0,
    skippedUnreadable: 0,
    entries: [],
  };

  const marker = readMarker(root);
  if (marker?.version === KB_MIGRATION_VERSION) {
    report.alreadyMigrated = true;
    return report;
  }

  // 목록은 meta.json이 정상인 KB만 준다. 폴더 이름만 있고 meta가 깨진 것은 건드리지 않는다.
  const kbs: KnowledgeBase[] = await store.list();
  // list()는 읽을 수 없는 KB 폴더를 조용히 건너뛴다. 그런 폴더가 있으면 표식을 쓰지 않는다 (나중에 고쳐지면 다시 처리)
  const listed = new Set(kbs.map((kb) => kb.id));
  report.skippedUnreadable = countUnlistedKbDirs(root, listed);
  for (const kb of kbs) {
    report.scanned++;
    const id = kb.id;
    try {
      if (kb.kind === 'codebase') {
        // 코드베이스로 확정된 KB: 남아 있는 색인 파일만 백업 폴더로 옮긴다 (이미 옮겼으면 아무 일도 없다)
        if (hasIndexFiles(path.join(root, id))) {
          await opts.indexer?.release(id);
          await store.setKind(id, 'codebase', { version: KB_MIGRATION_VERSION, at: now(), reason: 'codebase_index_backup' });
          report.backedUp++;
          report.entries.push({ id, action: 'backed_up', kind: 'codebase' });
        } else {
          report.unchanged++;
          report.entries.push({ id, action: 'unchanged', kind: 'codebase' });
        }
        continue;
      }
      if (kb.kind === 'document') {
        report.unchanged++;
        report.entries.push({ id, action: 'unchanged', kind: 'document' });
        continue;
      }

      // 미분류: 확실한 것만 유형을 기록하고, 나머지는 추정만 남긴다
      const sources = await store.sources(id);
      const paths = await fileSample(store, id);
      const verdict = classifyLegacyKnowledge({ sourceTypes: sources.map((s) => s.type), paths });
      if (verdict.certain && verdict.kind) {
        const record: KbMigrationRecord = { version: KB_MIGRATION_VERSION, at: now(), reason: verdict.suggestion?.reason ?? 'certain' };
        await store.setKind(id, verdict.kind, record);
        report.classified++;
        report.entries.push({ id, action: 'classified', kind: verdict.kind, reason: record.reason });
      } else if (verdict.suggestion) {
        await store.setKindSuggestion(id, verdict.suggestion);
        report.suggested++;
        report.entries.push({ id, action: 'suggested', kind: verdict.suggestion.kind, reason: verdict.suggestion.reason });
      } else {
        report.unchanged++;
        report.entries.push({ id, action: 'unchanged' });
      }
    } catch (err) {
      report.errors++;
      report.entries.push({ id, action: 'error' });
      // 오류 내용은 KB 이름·경로를 담을 수 있어 종류만 남긴다
      log(`kb-migration: ${id} 실패 (${err instanceof Error ? err.name : 'unknown'})`);
    }
  }

  if (report.errors === 0 && report.skippedUnreadable === 0) {
    writeMarker(root, { version: KB_MIGRATION_VERSION, completedAt: now() });
    report.markerWritten = true;
  }

  log(
    `kb-migration: scanned=${report.scanned} classified=${report.classified} suggested=${report.suggested} ` +
      `backedUp=${report.backedUp} unchanged=${report.unchanged} errors=${report.errors} skippedUnreadable=${report.skippedUnreadable}`,
  );
  return report;
}
