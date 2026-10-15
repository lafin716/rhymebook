// whisper.cpp의 whisper-cli를 빌드해 앱에 동봉할 위치(vendor/whisper/<os>-<arch>/)에 둔다 (ADR-045).
// 이미 있으면 건너뛴다. 빌드할 수 없으면 경고만 하고 넘어간다 — 앱은 PATH의 whisper-cli(brew install whisper-cpp)를 찾는다.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1.9.5';
const here = path.dirname(fileURLToPath(import.meta.url));
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform] ?? process.platform;
const outDir = path.join(here, '..', 'vendor', 'whisper', `${OS}-${process.arch}`);
const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
const out = path.join(outDir, exe);

// electron-builder extraResources가 디렉터리를 기대하므로 항상 만든다
mkdirSync(outDir, { recursive: true });

if (existsSync(out)) {
  console.log(`[whisper] 이미 있음: ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}
if (process.platform !== 'darwin') {
  console.warn('[whisper] macOS 외 플랫폼 번들은 아직 지원하지 않습니다. PATH의 whisper-cli를 사용합니다.');
  process.exit(0);
}

const has = (cmd) => {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
if (!has('git') || !has('cmake')) {
  console.warn('[whisper] git·cmake가 없어 whisper-cli를 빌드하지 않습니다 (brew install cmake). PATH의 whisper-cli를 사용합니다.');
  process.exit(0);
}

const src = process.env.WHISPER_SRC ?? path.join(os.homedir(), '.cache', 'rhymebook', `whisper.cpp-${VERSION}`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
try {
  if (!existsSync(path.join(src, 'CMakeLists.txt'))) {
    mkdirSync(path.dirname(src), { recursive: true });
    run('git', ['clone', '--depth', '1', '--branch', VERSION, 'https://github.com/ggml-org/whisper.cpp.git', src]);
  }
  // Metal 셰이더를 바이너리에 넣고 정적 링크 — 시스템 프레임워크 외 의존성 없음
  run('cmake', [
    '-B', 'build',
    '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON', '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
  ], src);
  run('cmake', ['--build', 'build', '-j', '--config', 'Release', '--target', 'whisper-cli'], src);
  copyFileSync(path.join(src, 'build', 'bin', exe), out);
  chmodSync(out, 0o755);
  console.log(`[whisper] 빌드 완료: ${path.relative(process.cwd(), out)}`);
} catch (e) {
  console.warn(`[whisper] 빌드 실패 — PATH의 whisper-cli를 사용합니다: ${e instanceof Error ? e.message : e}`);
}
