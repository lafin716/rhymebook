import readline from 'node:readline';
import path from 'node:path';
import { KB_MAX_KBS_PER_CHAT } from './config';
import { createMcpHandler, parseLine, type JsonRpcResponse } from './mcp';
import { KbToolService, type KbEntry } from './service';
import { filesRootOf, readKbMeta } from '../knowledgeMeta';

const KB_ID_RE = /^kb[a-z0-9]{6,40}$/;

/**
 * 명령행 KB 목록을 실제 폴더와 대조한다. 이름·유형·제외 규칙·연결 폴더는 meta.json에서 읽는다 (knowledgeMeta 공용 도우미).
 * 연결 폴더 코드베이스가 사라졌으면 항목은 남기고 missing으로 표시한다 (도구 호출 때 not_found로 알린다).
 */
export async function loadKbEntries(root: string, kbIds: string[]): Promise<{ entries: KbEntry[]; problems: string[] }> {
  const entries: KbEntry[] = [];
  const problems: string[] = [];
  const unique = [...new Set(kbIds)].slice(0, KB_MAX_KBS_PER_CHAT);
  for (const kbId of unique) {
    if (!KB_ID_RE.test(kbId)) {
      problems.push(`invalid kb id skipped`);
      continue;
    }
    const meta = readKbMeta(root, kbId);
    const resolved = filesRootOf(root, kbId, meta);
    const missing = resolved === undefined;
    const filesRoot = resolved ?? path.join(root, kbId, 'files');
    if (missing) problems.push(`linked folder missing: ${kbId}`);
    entries.push({
      kbId,
      kbName: meta?.name ?? kbId,
      filesRoot,
      ...(meta?.kind ? { kind: meta.kind } : {}),
      excludes: meta?.excludes ?? [],
      ...(missing ? { missing: true } : {}),
    });
  }
  return { entries, problems };
}

/**
 * stdio JSON-RPC 루프. 한 줄이 한 메시지. 응답은 한 줄 JSON.
 * 입력이 끝나면 대기 중인 응답을 마저 보내고 종료한다.
 */
export function serveStdio(service: KbToolService, input: NodeJS.ReadableStream, output: NodeJS.WritableStream, serverVersion = '1.0.0'): Promise<void> {
  const handle = createMcpHandler({
    serverName: 'octobooks',
    serverVersion,
    callTool: (name, args) => service.call(name, args),
  });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  const send = (res: JsonRpcResponse | undefined) => {
    if (res) output.write(JSON.stringify(res) + '\n');
  };
  rl.on('line', (line) => {
    const msg = parseLine(line);
    if (!msg) return;
    if ('parseError' in msg) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    const p = handle(msg)
      .then(send)
      .catch(() => send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: 'internal error' } }))
      .finally(() => pending.delete(p));
    pending.add(p);
  });
  return new Promise((resolve) => {
    rl.on('close', () => {
      void Promise.allSettled([...pending]).then(() => resolve());
    });
  });
}
