import type { ConnectionState, ID, Message, Session, Settings, ViewState } from './model';

/**
 * 영속화 경계. 스토어는 변경 후 해당 메서드를 호출하기만 하며 결과를 기다리지 않는다.
 * 웹/데스크톱/모바일은 Dexie(IndexedDB) 구현을 쓴다(packages/ui/src/persist).
 */
export interface Repository {
  saveSession(s: Session): void;
  /** 세션과 그 메시지를 함께 지운다 */
  deleteSessions(ids: ID[]): void;
  /** index = 세션 메시지 목록에서의 위치 (복원 시 정렬 기준) */
  saveMessage(m: Message, index: number): void;
  deleteMessage(id: ID): void;
  saveView(v: ViewState): void;
  saveSettings(s: Settings): void;
  saveConnections(c: ConnectionState[]): void;
}

export const memoryRepository = (): Repository => ({
  saveSession() {},
  deleteSessions() {},
  saveMessage() {},
  deleteMessage() {},
  saveView() {},
  saveSettings() {},
  saveConnections() {},
});

/** 조건이 참일 때만 쓰기를 통과시킨다 (데모 모드에서는 저장하지 않기 위해) */
export function gatedRepository(repo: Repository, enabled: () => boolean): Repository {
  const wrap =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      if (enabled()) fn(...a);
    };
  return {
    saveSession: wrap(repo.saveSession),
    deleteSessions: wrap(repo.deleteSessions),
    saveMessage: wrap(repo.saveMessage),
    deleteMessage: wrap(repo.deleteMessage),
    saveView: wrap(repo.saveView),
    saveSettings: wrap(repo.saveSettings),
    saveConnections: wrap(repo.saveConnections),
  };
}
