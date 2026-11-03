import type { DesktopKnowledgeApi } from '@branch/core';
import { desktop } from '../app/runtime';

declare global {
  interface Window {
    /** 개발 서버 e2e 전용 가짜 지식베이스 API (프로덕션 빌드에서는 읽지 않는다) */
    __branchKnowledgeFake?: DesktopKnowledgeApi;
  }
}

/**
 * 지식베이스 API. 데스크톱은 bridge가 준 구현을 쓰고, 개발 서버에서만 e2e가 넣은 가짜를 쓴다.
 * 없으면 (웹·모바일 로컬) 지식베이스 기능은 보이지 않는다.
 */
export function knowledgeApi(): DesktopKnowledgeApi | undefined {
  if (desktop?.knowledge) return desktop.knowledge;
  if (import.meta.env.DEV && typeof window !== 'undefined') return window.__branchKnowledgeFake;
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
