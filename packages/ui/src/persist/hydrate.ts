import { emptyView, restoreData, RUNTIME_SETTINGS, toStoredData, type AppData } from '@branch/core';
import type { DexieRepository } from './db';

/** 첫 실행 데이터: 빈 학습 목록 + 실제 provider 설정 */
export function firstRunData(): AppData {
  return restoreData(
    toStoredData({
      sessions: {},
      messages: {},
      annotations: {},
      view: emptyView(),
      settings: RUNTIME_SETTINGS,
      connections: {} as AppData['connections'],
    }),
  );
}

/**
 * 저장소에서 앱 데이터를 읽는다. 비어 있으면 첫 실행 데이터를 저장하고 돌려준다.
 * 읽기에 실패하면(사생활 보호 모드 등) 빈 데이터로 메모리에서만 동작한다.
 */
export async function hydrate(repo: DexieRepository): Promise<{ data: AppData; persisted: boolean }> {
  try {
    const raw = await repo.loadAll();
    if (raw) return { data: restoreData(raw), persisted: true };
    const data = firstRunData();
    await repo.replaceAll(toStoredData(data));
    return { data, persisted: true };
  } catch (e) {
    console.warn('[persist] 불러오기 실패, 이번 실행은 저장되지 않습니다', e);
    return { data: firstRunData(), persisted: false };
  }
}
