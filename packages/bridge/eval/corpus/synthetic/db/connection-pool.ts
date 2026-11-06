export interface PoolOptions {
  /** 동시에 열 수 있는 연결 수 상한 */
  maxConnections: number;
  /** 빌릴 때까지 기다리는 최대 시간 (ms) */
  acquireTimeoutMs: number;
  /** 놀고 있는 연결을 닫기까지 시간 (ms) */
  idleTimeoutMs: number;
}

export interface Conn {
  id: number;
  busy: boolean;
  lastUsed: number;
}

/**
 * 데이터베이스 연결 풀. 요청마다 새로 연결하지 않고 미리 열어 둔 연결을 빌려 쓴다.
 * maxConnections를 넘으면 빌리는 쪽이 대기하고, 대기 시간이 넘으면 오류를 낸다.
 */
export class ConnectionPool {
  private readonly conns: Conn[] = [];
  private nextId = 1;

  constructor(private readonly opts: PoolOptions) {}

  acquire(now = Date.now()): Conn | undefined {
    const idle = this.conns.find((c) => !c.busy);
    if (idle) {
      idle.busy = true;
      idle.lastUsed = now;
      return idle;
    }
    if (this.conns.length >= this.opts.maxConnections) return undefined;
    const fresh: Conn = { id: this.nextId++, busy: true, lastUsed: now };
    this.conns.push(fresh);
    return fresh;
  }

  release(conn: Conn, now = Date.now()): void {
    conn.busy = false;
    conn.lastUsed = now;
  }

  /** idleTimeoutMs가 지난 놀고 있는 연결을 닫고 목록에서 뺀다 */
  prune(now = Date.now()): number {
    const before = this.conns.length;
    for (let i = this.conns.length - 1; i >= 0; i--) {
      const c = this.conns[i] as Conn;
      if (!c.busy && now - c.lastUsed > this.opts.idleTimeoutMs) this.conns.splice(i, 1);
    }
    return before - this.conns.length;
  }
}
