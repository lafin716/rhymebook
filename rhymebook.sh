#!/usr/bin/env sh
# rhymebook 헤드리스 호스트 실행 (macOS·Linux)
#   ./rhymebook.sh                 → serve (이미 페어링한 기기만 접속)
#   ./rhymebook.sh --pair          → serve --pair (QR·링크·코드 표시)
#   ./rhymebook.sh devices | unpair <id|all> | pair | --help
# 처음이면 의존성을 설치하고, 실행할 때마다 서버를 다시 빌드한다(1~2초).
# 빌드를 건너뛰려면 RHYMEBOOK_NO_BUILD=1
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 필요합니다 (20 이상). https://nodejs.org" >&2
  exit 1
fi
if command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
elif command -v corepack >/dev/null 2>&1; then
  PNPM="corepack pnpm"
else
  echo "pnpm이 필요합니다: npm i -g pnpm" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "의존성 설치 중..."
  $PNPM install
fi
if [ "${RHYMEBOOK_NO_BUILD:-}" != "1" ] || [ ! -f packages/server/dist/rhymebook.cjs ]; then
  if ! out=$($PNPM --silent --filter @branch/server build 2>&1); then
    echo "$out" >&2
    echo "서버 빌드에 실패했습니다." >&2
    exit 1
  fi
fi

# 인자가 없거나 옵션으로 시작하면 serve
case "${1:-}" in
  '') set -- serve ;;
  -h|--help) ;;
  -*) set -- serve "$@" ;;
esac

exec node packages/server/dist/rhymebook.cjs "$@"
