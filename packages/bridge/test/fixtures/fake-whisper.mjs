#!/usr/bin/env node
// whisper-cli 흉내: -m 모델, -f 입력 파일. 모델 파일 내용으로 동작을 고른다
// (엔진이 환경 변수를 거르므로 환경 변수로는 고를 수 없다)
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const at = (k) => args[args.indexOf(k) + 1];
const model = readFileSync(at('-m'), 'utf8');
if (model === 'fail-model') {
  process.stderr.write('error: failed to load model\n');
  process.exit(3);
}
if (model === 'envs-model') {
  process.stdout.write(`키 ${process.env.ANTHROPIC_API_KEY ?? '없음'} 경로 ${process.env.PATH ? '있음' : '없음'}\n`);
  process.exit(0);
}
if (model === 'slow-model') await new Promise((r) => setTimeout(r, 400));
const wav = readFileSync(at('-f'));
process.stderr.write('read_audio_data: ...\n');
process.stdout.write(` [음악]\n 모델 ${model} 길이 ${wav.length} 언어 ${at('-l')}\n`);
