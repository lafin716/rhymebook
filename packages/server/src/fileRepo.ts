import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Repository, StoredData } from '@branch/core';

/**
 * 헤드리스 호스트의 저장소 (IMP-14, ADR-040): `<dir>/data.json` 하나.
 * 스토어는 바뀔 때마다 Repository 메서드를 부르기만 하므로, 여기서는 "바뀜"만 기록하고
 * 잠시 뒤 스토어 전체 스냅샷을 원자적으로(임시 파일 → 이름 변경) 한 번 쓴다.
 * 스트리밍 중에도 최대 intervalMs마다 한 번만 쓴다.
 */
export interface FileRepository extends Repository {
  /** 저장된 원본. 파일이 없으면 null, 깨졌으면 throw */
  load(): StoredData | null;
  /** 쓸 내용을 주는 함수 (스토어가 만들어진 뒤 연결) */
  attach(snapshot: () => StoredData): void;
  /** 남은 쓰기를 지금 끝낸다 (종료 시) */
  flush(): Promise<void>;
}

export function createFileRepository(file: string, opts: { intervalMs?: number; log?: (msg: string) => void } = {}): FileRepository {
  const intervalMs = opts.intervalMs ?? 800;
  const log = opts.log ?? (() => {});
  let snapshot: (() => StoredData) | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  function schedule() {
    dirty = true;
    timer ??= setTimeout(() => {
      timer = null;
      void write();
    }, intervalMs);
  }

  function write(): Promise<void> {
    // 쓰기는 한 줄로 세운다 (앞 쓰기가 끝난 뒤의 최신 상태를 쓴다)
    writing = writing.then(async () => {
      if (!dirty || !snapshot) return;
      dirty = false;
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(tmp, JSON.stringify(snapshot()), { mode: 0o600 });
        await rename(tmp, file);
      } catch (e) {
        dirty = true;
        log(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return writing;
  }

  const touch = () => schedule();
  return {
    saveSession: touch,
    deleteSessions: touch,
    saveMessage: touch,
    deleteMessage: touch,
    saveView: touch,
    saveSettings: touch,
    saveConnections: touch,
    saveAnnotation: touch,
    deleteAnnotations: touch,

    load() {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
      const raw = JSON.parse(text) as unknown;
      if (!raw || typeof raw !== 'object' || !Array.isArray((raw as StoredData).sessions) || !Array.isArray((raw as StoredData).messages)) {
        throw new Error(`저장 파일 형식이 올바르지 않습니다: ${file}`);
      }
      return raw as StoredData;
    },

    attach(fn) {
      snapshot = fn;
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },
  };
}
