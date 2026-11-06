import type { DesktopKnowledgeApi } from '@branch/core';
import { desktop } from '../app/runtime';
import { remoteMode } from '../app/capabilities';

declare global {
  interface Window {
    /** 개발 서버 e2e 전용 가짜 지식베이스 API (프로덕션 빌드에서는 읽지 않는다) */
    __branchKnowledgeFake?: DesktopKnowledgeApi;
  }
}

/** 원격 분기: remoteApi.ts가 자기 자신을 등록한다 (app/sync를 직접 import하면 순환이 생긴다) */
let remoteSource: (() => DesktopKnowledgeApi | undefined) | undefined;

export function setRemoteKnowledgeApi(get: () => DesktopKnowledgeApi | undefined): void {
  remoteSource = get;
}

/**
 * 지식베이스 API.
 * - 데스크톱 창(세션 창 포함)은 로컬 desktop.knowledge를 쓴다.
 * - 원격(휴대폰·웹)은 sync RPC로 PC의 지식베이스를 쓴다. PC가 관리 기능을 지원하지 않으면 undefined.
 * - 개발 서버에서만 e2e가 넣은 가짜를 쓴다.
 * 없으면 지식베이스 기능은 보이지 않는다.
 */
export function knowledgeApi(): DesktopKnowledgeApi | undefined {
  if (desktop?.knowledge) return desktop.knowledge;
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.__branchKnowledgeFake) return window.__branchKnowledgeFake;
  if (remoteMode) return remoteSource?.();
  return undefined;
}

/**
 * IPC 실패 메시지에서 Electron이 붙이는 접두어를 떼어 낸다.
 * 예: "Error invoking remote method 'knowledge:list': Error: 디스크 오류" -> "디스크 오류"
 */
export function ipcErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim();
}
