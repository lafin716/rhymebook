import http from 'node:http';
import https from 'node:https';

/**
 * 링크 가져오기 전용 GET. 연결 직전에 호스트를 다시 풀고(lookup 훅),
 * 하나라도 막힌 주소면 소켓을 열지 않는다. DNS 리바인딩(검사 시점과 연결 시점의 주소 차이)을 막는다.
 */

export interface PinnedGetOptions {
  signal: AbortSignal;
  headers: Record<string, string>;
  /** 호스트 이름 → 주소 목록. 연결 직전마다 호출된다 */
  resolve: (hostname: string) => Promise<string[]>;
  /** 주소가 막혀야 하면 true */
  isBlocked: (address: string) => boolean;
}

export interface PinnedResponse {
  status: number;
  headers: Headers;
  /** 본문을 읽는다. maxBytes를 넘으면 null (연결은 끊는다) */
  read(maxBytes: number): Promise<Uint8Array | null>;
}

/** 연결 직전 검사에서 막힌 경우 */
export class LinkBlockedError extends Error {
  constructor() {
    super('blocked address');
    this.name = 'LinkBlockedError';
  }
}

function toHeaders(raw: http.IncomingHttpHeaders): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) h.append(k, item);
    else h.set(k, v);
  }
  return h;
}

export function pinnedGet(url: URL, o: PinnedGetOptions): Promise<PinnedResponse> {
  return new Promise<PinnedResponse>((resolve, reject) => {
    let blocked = false;
    const lookup = (hostname: string, options: unknown, cb: (...args: unknown[]) => void) => {
      o.resolve(hostname).then(
        (addrs) => {
          if (addrs.length === 0 || addrs.some((a) => o.isBlocked(a))) {
            blocked = true;
            cb(new LinkBlockedError());
            return;
          }
          const fam = (a: string) => (a.includes(':') ? 6 : 4);
          if (typeof options === 'object' && options !== null && (options as { all?: boolean }).all) {
            cb(null, addrs.map((a) => ({ address: a, family: fam(a) })));
          } else {
            cb(null, addrs[0], fam(addrs[0]!));
          }
        },
        (err: unknown) => cb(err),
      );
    };
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: { ...o.headers, 'accept-encoding': 'identity' },
        signal: o.signal,
        lookup: lookup as unknown as http.RequestOptions['lookup'],
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) res.resume();
        resolve({
          status,
          headers: toHeaders(res.headers),
          read: (maxBytes: number) =>
            new Promise<Uint8Array | null>((ok, bad) => {
              const chunks: Buffer[] = [];
              let total = 0;
              res.on('data', (c: Buffer) => {
                total += c.length;
                if (total > maxBytes) {
                  res.destroy();
                  ok(null);
                  return;
                }
                chunks.push(c);
              });
              res.on('end', () => ok(new Uint8Array(Buffer.concat(chunks))));
              res.on('error', bad);
              res.on('aborted', () => bad(new Error('aborted')));
            }),
        });
      },
    );
    req.on('error', (err) => reject(blocked ? new LinkBlockedError() : err));
    req.end();
  });
}
