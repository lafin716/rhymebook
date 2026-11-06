import { useMemo } from 'react';
import type { DesktopKnowledgeApi, SyncHostInfo } from '@branch/core';
import { syncClient, useSync } from '../app/sync';
import { knowledgeApi, setRemoteKnowledgeApi } from './api';
import { createRemoteKnowledgeApi, type UploadSource } from './remoteKnowledge';

/** 휴대폰·웹이 파일을 고를 때 쓰는 숨김 input. 취소하면 빈 배열 */
function pickFilesFromDisk(): Promise<UploadSource[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    const done = (files: UploadSource[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      done(
        files.map((f) => ({
          name: f.name,
          size: f.size,
          bytes: async () => new Uint8Array(await f.arrayBuffer()),
        })),
      );
    };
    input.oncancel = () => done([]);
    document.body.appendChild(input);
    // 사용자 제스처 안에서 동기로 열어야 한다
    input.click();
  });
}

let cached: { client: NonNullable<typeof syncClient>; api: DesktopKnowledgeApi } | null = null;

/** 현재 sync 연결의 원격 지식베이스 API. 연결이 없거나 PC가 관리 기능을 지원하지 않으면 undefined */
function remoteApi(): DesktopKnowledgeApi | undefined {
  const client = syncClient;
  if (!client || !client.state.getState().manage) return undefined;
  if (!cached || cached.client !== client) {
    cached = {
      client,
      api: createRemoteKnowledgeApi({
        rpc: (method, args, opts) => client.rpc(method, args, opts),
        onEvent: (listener) => client.onEvent(listener),
        pickFiles: pickFilesFromDisk,
      }),
    };
  }
  return cached.api;
}

// knowledge/api.ts가 원격 분기에서 이 함수를 부른다 (app/sync 직접 import는 순환을 만든다)
setRemoteKnowledgeApi(() => remoteApi());

/** 지식베이스 API를 React에서 쓴다. sync가 연결·업데이트 여부를 바꾸면 다시 얻는다 */
export function useKnowledgeApi(): DesktopKnowledgeApi | undefined {
  const manage = useSync((s) => s.manage);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- manage 변화가 연결 상태 변화를 알리는 신호다
  return useMemo(() => knowledgeApi(), [manage]);
}

/** 원격 연결 상태 (PC 관리 가능 여부 포함) */
export function useRemoteState(): { status: string; manage: boolean | undefined } {
  const status = useSync((s) => s.status);
  const manage = useSync((s) => s.manage);
  return { status, manage };
}

/** PC의 원격 삭제 허용 여부 (host.info). 실패하면 false */
export async function fetchAllowDelete(): Promise<boolean> {
  const client = syncClient;
  if (!client) return false;
  try {
    const info = await client.rpc<SyncHostInfo>('host.info');
    return !!info.allowDelete;
  } catch {
    return false;
  }
}

/** PC에서 지식베이스가 바뀌었을 때 알림 ('knowledge' 토픽). 해제 함수를 돌려준다 */
export function onRemoteKnowledgeChanged(listener: () => void): () => void {
  const client = syncClient;
  if (!client) return () => {};
  return client.onEvent((topic) => {
    if (topic === 'knowledge') listener();
  });
}
