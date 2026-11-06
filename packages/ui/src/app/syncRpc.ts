import {
  createUploadAssembler,
  isDocSession,
  sanitizePromptOverrides,
  SyncRpcFailure,
  uploadChunkFromArgs,
  validateRpcArgs,
  type DesktopKnowledgeApi,
  type KnowledgeIndexSettings,
  type Schedule,
  type ScheduleInput,
  type SkillRef,
  type SyncEventTopic,
  type SyncHostInfo,
  type SyncRpcMethod,
} from '@branch/core';
import { ipcErrorMessage } from '../knowledge/api';
import { useSchedules } from '../schedules/store';
import { desktop } from './runtime';
import { actions, appStore } from './store';

/**
 * PC 메인 창의 원격 관리 처리기 (ADR-116·117).
 * 휴대폰·웹·세션 창이 보낸 sync.rpc를 예약 저장소·설정·desktop.knowledge로 보낸다.
 * 인자 형태는 host가 이미 확인했지만 여기서 다시 확인한다 (main IPC가 내용을 또 본다).
 *
 * 순환 import(schedules/store → app/sync → 여기)가 있으므로 모듈 최상위에서는 다른 모듈 값을 읽지 않는다.
 */
export interface SyncRpcDeps {
  /** 이 피어가 지식베이스·항목을 지울 수 있는가 */
  allowDelete(peerId: string): boolean;
  /** 변경을 연결된 모든 기기에 알린다 */
  emit(topic: SyncEventTopic, data?: unknown): void;
}

const kbApi = (): DesktopKnowledgeApi => {
  const api = desktop?.knowledge;
  if (!api) throw new SyncRpcFailure('unsupported');
  return api;
};

/** optional 메서드가 없으면 unsupported */
function need<T>(fn: T | undefined): T {
  if (!fn) throw new SyncRpcFailure('unsupported');
  return fn;
}

/** IPC 오류 접두어를 떼어 보여줄 문구로 바꾼다 */
async function ipc<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof SyncRpcFailure) throw e;
    throw new Error(ipcErrorMessage(e) || 'failed', { cause: e });
  }
}

/** 예약 목록의 변화 서명 (3초 새로고침마다 같은 목록을 다시 방송하지 않게) */
export function scheduleSignature(items: readonly Schedule[]): string {
  return items.map((s) => `${s.id}:${s.updatedAt}:${s.nextRunAt}:${s.enabled ? 1 : 0}:${s.pendingRunAt ?? ''}:${s.lastRunAt ?? ''}:${s.lastError ?? ''}`).join('|');
}

export function createSyncRpcHandler(deps: SyncRpcDeps) {
  const uploads = new Map<string, ReturnType<typeof createUploadAssembler>>();
  const assembler = (peerId: string) => {
    let a = uploads.get(peerId);
    if (!a) {
      a = createUploadAssembler();
      uploads.set(peerId, a);
    }
    return a;
  };
  const requireDelete = (peerId: string) => {
    if (!deps.allowDelete(peerId)) throw new SyncRpcFailure('forbidden');
  };
  /** 지식베이스를 바꾼 뒤 목록 새로고침을 알린다 */
  const changed = async <T>(run: () => Promise<T>): Promise<T> => {
    const out = await ipc(run);
    deps.emit('knowledge');
    return out;
  };

  async function handle(peerId: string, method: SyncRpcMethod, rawArgs: unknown[]): Promise<unknown> {
    const args = validateRpcArgs(method, rawArgs);
    if (!args) throw new SyncRpcFailure('invalid');
    const s = (i: number) => args[i] as string;
    switch (method) {
      case 'host.info': {
        const info: SyncHostInfo = {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          knowledge: !!desktop?.knowledge,
          allowDelete: deps.allowDelete(peerId),
        };
        return info;
      }

      /* ── 예약 ── */
      case 'schedules.list': {
        await useSchedules.getState().refresh();
        const st = useSchedules.getState();
        if (st.error) throw new Error(st.error);
        return st.items;
      }
      case 'schedules.save': {
        const sessionId = s(1);
        const session = appStore.getState().sessions[sessionId];
        if (!session || isDocSession(session)) throw new SyncRpcFailure('not-found');
        const skill = args[3] as SkillRef | null | undefined;
        return useSchedules.getState().save(args[0] as ScheduleInput, sessionId, args[2] as string | undefined, skill);
      }
      case 'schedules.remove':
        return useSchedules.getState().remove(s(0));
      case 'schedules.toggle':
        return useSchedules.getState().toggle(s(0));

      /* ── 프롬프트 ── */
      case 'prompts.get':
        return sanitizePromptOverrides(appStore.getState().settings.prompts);
      case 'prompts.set': {
        const prompts = sanitizePromptOverrides(args[0]);
        // 방송은 attachEvents의 설정 구독이 한다 (예약도 같다: 저장 후 refresh → 목록 구독)
        actions().updateSettings({ prompts });
        return prompts;
      }

      /* ── 지식베이스 ── */
      case 'knowledge.list':
        return ipc(() => kbApi().list());
      case 'knowledge.create':
        return changed(() => kbApi().create(s(0)));
      case 'knowledge.rename':
        return changed(() => kbApi().rename(s(0), s(1)));
      case 'knowledge.remove':
        requireDelete(peerId);
        return changed(() => kbApi().remove(s(0)));
      case 'knowledge.tree':
        return ipc(() => kbApi().tree(s(0), args[1] as string | undefined));
      case 'knowledge.addLink':
        return changed(() => kbApi().addLink(s(0), s(1)));
      case 'knowledge.cloneGit':
        return changed(() => kbApi().cloneGit(s(0), s(1)));
      case 'knowledge.removeEntry':
        requireDelete(peerId);
        return changed(() => kbApi().removeEntry(s(0), s(1)));
      case 'knowledge.preview':
        return ipc(() => kbApi().preview(s(0), s(1)));
      case 'knowledge.cancel': {
        const api = kbApi();
        return ipc(() => need(api.cancel).call(api));
      }
      case 'knowledge.setDescription': {
        const api = kbApi();
        return changed(() => need(api.setDescription).call(api, s(0), s(1)));
      }
      case 'knowledge.indexStates': {
        const api = kbApi();
        return ipc(() => need(api.indexStates).call(api, args[0] as string[] | undefined));
      }
      case 'knowledge.reindex': {
        const api = kbApi();
        return ipc(() => need(api.reindex).call(api, s(0), args[1] as { full?: boolean } | undefined));
      }
      case 'knowledge.cancelIndex': {
        const api = kbApi();
        return ipc(() => need(api.cancelIndex).call(api, s(0)));
      }
      case 'knowledge.docs': {
        const api = kbApi();
        return ipc(() => need(api.docs).call(api, s(0), args[1] as string | undefined));
      }
      case 'knowledge.getIndexSettings': {
        const api = kbApi();
        return ipc(() => need(api.getIndexSettings).call(api, s(0)));
      }
      case 'knowledge.setIndexSettings': {
        const api = kbApi();
        return changed(() => need(api.setIndexSettings).call(api, s(0), args[1] as KnowledgeIndexSettings));
      }
      case 'knowledge.sources': {
        const api = kbApi();
        return ipc(() => need(api.sources).call(api, s(0)));
      }
      case 'knowledge.updateSource': {
        const api = kbApi();
        return changed(() => need(api.updateSource).call(api, s(0), s(1)));
      }
      case 'knowledge.source': {
        const api = kbApi();
        return ipc(() => need(api.source).call(api, s(0), s(1)));
      }
      case 'knowledge.upload': {
        const api = kbApi();
        const pushed = assembler(peerId).push(uploadChunkFromArgs(args));
        if (!pushed.ok) throw new SyncRpcFailure(pushed.error === 'busy' ? 'rate-limit' : 'invalid');
        if (!pushed.done) return { received: pushed.received };
        const { file } = pushed;
        return changed(() => api.addFiles(file.kbId, [{ name: file.name, data: file.data }], file.dest));
      }
    }
    throw new SyncRpcFailure('unsupported');
  }

  return {
    handle,
    /** 끊긴 피어의 조립 중인 업로드를 버린다 */
    peerGone(peerId: string) {
      uploads.get(peerId)?.clear();
      uploads.delete(peerId);
    },
    /**
     * PC 쪽 변화(예약 엔진 실행·PC에서 고친 예약·프롬프트, 지식베이스 진행률·색인 상태)를 방송한다.
     * 모든 모듈을 읽은 뒤(시작 시) 부른다. 해제 함수를 돌려준다.
     */
    attachEvents(): () => void {
      const offs: (() => void)[] = [];
      let sig = scheduleSignature(useSchedules.getState().items);
      offs.push(useSchedules.subscribe((st) => {
        const next = scheduleSignature(st.items);
        if (next === sig) return;
        sig = next;
        deps.emit('schedules');
      }));
      let prompts = appStore.getState().settings.prompts;
      offs.push(appStore.subscribe((st) => {
        if (st.settings.prompts === prompts) return;
        prompts = st.settings.prompts;
        deps.emit('prompts');
      }));
      const api = desktop?.knowledge;
      const offProgress = api?.onProgress?.((p) => deps.emit('knowledge.progress', p));
      if (offProgress) offs.push(offProgress);
      const offIndex = api?.onIndexState?.((s) => deps.emit('knowledge.index', s));
      if (offIndex) offs.push(offIndex);
      return () => offs.forEach((off) => off());
    },
  };
}
