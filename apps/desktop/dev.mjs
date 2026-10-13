// 개발 실행: main/preload 빌드 후 Vite 개발 서버(BRANCH_DEV_URL)를 로드하는 Electron 실행.
// `VAR=값 cmd` 문법은 Windows cmd.exe에서 동작하지 않으므로 Node에서 환경변수를 설정한다.
// 개발 서버가 떠 있지 않으면 `pnpm --filter @branch/ui dev`를 함께 띄우고, Electron 종료 시 같이 끈다.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const DEV_URL = process.env.BRANCH_DEV_URL ?? 'http://localhost:5173';

async function reachable() {
  try {
    await fetch(DEV_URL, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

const build = spawnSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

let vite;
if (!(await reachable())) {
  console.log(`개발 서버(${DEV_URL})가 없어 Vite를 시작합니다...`);
  vite = spawn('pnpm', ['--filter', '@branch/ui', 'dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const deadline = Date.now() + 60_000;
  while (!(await reachable())) {
    if (vite.exitCode !== null || Date.now() > deadline) {
      console.error('Vite 개발 서버를 시작하지 못했습니다.');
      stopVite();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function stopVite() {
  if (!vite || vite.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    vite.kill();
  }
}

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, BRANCH_DEV_URL: DEV_URL },
});
child.on('exit', (code) => {
  stopVite();
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill();
    stopVite();
    process.exit(0);
  });
}
