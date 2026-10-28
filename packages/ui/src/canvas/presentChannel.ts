import type { CanvasDoc, ID } from '@branch/core';
import { desktop } from '../app/runtime';

export interface PresentMessage {
  type: 'hello' | 'doc' | 'page' | 'ink' | 'laser' | 'end';
  doc?: CanvasDoc;
  page?: number;
  items?: CanvasDoc['strokes'];
  p?: { x: number; y: number } | null;
}

export interface PresentChannel {
  send(msg: PresentMessage): void;
  onMessage(listener: (msg: PresentMessage) => void): () => void;
  close(): void;
}

/**
 * 웹: BroadcastChannel 사용
 * 데스크톱: IPC 중계 (file:// URL에서는 BroadcastChannel이 보장되지 않음)
 */
export function createPresentChannel(sessionId: ID): PresentChannel {
  if (desktop?.windows?.present) {
    // 데스크톱 IPC 모드
    const send = (msg: PresentMessage) => {
      desktop!.windows!.present!.send(msg as unknown as Record<string, unknown>);
    };

    const onMessage = (fn: (msg: PresentMessage) => void) => {
      const unsub = desktop!.windows!.present!.onMessage((raw: Record<string, unknown>) => {
        fn(raw as unknown as PresentMessage);
      });
      return unsub;
    };

    const close = () => {
      // 소켓 정리는 desktop.windows.present.close()에서 처리
    };

    return { send, onMessage, close };
  }

  // 웹 BroadcastChannel 모드
  const channelName = `octobooks-present:${sessionId}`;
  const bc = new BroadcastChannel(channelName);

  const send = (msg: PresentMessage) => {
    bc.postMessage(msg);
  };

  const onMessage = (listener: (msg: PresentMessage) => void) => {
    const handler = (event: MessageEvent<PresentMessage>) => {
      listener(event.data);
    };
    bc.addEventListener('message', handler);
    return () => bc.removeEventListener('message', handler);
  };

  const close = () => {
    bc.close();
  };

  return { send, onMessage, close };
}
