/**
 * kbMcp 번들 진입점. 사용법: kbMcp.cjs --root <knowledge 루트> --kb <kbId> [--kb <kbId> ...]
 * 표준 출력은 JSON-RPC 전용이고, 로그는 표준 오류로만 쓴다.
 */
import { KbToolService } from './service';
import { loadKbEntries, serveStdio } from './serve';

function parseArgs(argv: string[]): { root?: string; kbIds: string[] } {
  let root: string | undefined;
  const kbIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--kb' && argv[i + 1]) kbIds.push(argv[++i]!);
  }
  return { root, kbIds };
}

async function main(): Promise<void> {
  const { root, kbIds } = parseArgs(process.argv.slice(2));
  if (!root) {
    process.stderr.write('kbMcp: --root is required\n');
    process.exit(2);
  }
  const { entries, problems } = await loadKbEntries(root, kbIds);
  for (const p of problems) process.stderr.write(`kbMcp: ${p}\n`);
  // 색인은 읽기 전용으로만 연다 (키 없음, 쓰기 없음). 색인이 없으면 키워드 스캔으로 대신한다
  const service = new KbToolService({ kbs: entries, root });
  await serveStdio(service, process.stdin, process.stdout);
}

void main();
