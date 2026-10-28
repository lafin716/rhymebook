#!/usr/bin/env bash
# 헤드리스 호스트(rhymebook serve)를 (재)실행한다.
#   restart.sh [serve 옵션...]   기본 옵션: --pair (+ 번들 whisper-cli가 있으면 --whisper-cli)
#   restart.sh --stop            끄기만
# 떠 있으면 SIGINT(Ctrl+C와 같음, 진행 중 답변 저장)로 끄고 다시 띄운다. 로그: $RHYMEBOOK_SERVE_LOG(기본 /tmp/rhymebook-serve.log)
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
LOG="${RHYMEBOOK_SERVE_LOG:-/tmp/rhymebook-serve.log}"
PORT="${RHYMEBOOK_PORT:-7777}"

pids() { pgrep -f "packages/server/dist/rhymebook.cjs serve" | while read -r p; do
  # 이 저장소에서 띄운 것만
  [ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$ROOT" ] && echo "$p"; done; }

old="$(pids)"
if [ -n "$old" ]; then
  echo "실행 중인 호스트 종료: $old"
  kill -INT $old
  for _ in $(seq 1 15); do [ -z "$(pids)" ] && break; sleep 1; done
  left="$(pids)"
  if [ -n "$left" ]; then echo "15초 안에 안 꺼져 SIGTERM: $left"; kill -TERM $left; sleep 2; fi
fi
[ "${1:-}" = "--stop" ] && { echo "종료만 했습니다."; exit 0; }

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT 를 다른 프로세스가 쓰고 있습니다:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  set -- --pair
  W="$ROOT/apps/desktop/vendor/whisper/mac-arm64/whisper-cli"
  [ -x "$W" ] && set -- "$@" --whisper-cli "$W"
fi

cd "$ROOT"
nohup ./rhymebook.sh "$@" > "$LOG" 2>&1 < /dev/null &
echo "시작: ./rhymebook.sh $* (PID $!, 로그 $LOG)"

for _ in $(seq 1 60); do
  grep -q "실행 중 (포트" "$LOG" 2>/dev/null && break
  kill -0 $! 2>/dev/null || { echo "호스트가 시작 중 종료됐습니다:" >&2; tail -30 "$LOG" >&2; exit 1; }
  sleep 1
done
sleep 1
# QR 블록 문자 줄은 빼고 요약만
grep -vE '^[[:space:]▀▄█]*$' "$LOG"
