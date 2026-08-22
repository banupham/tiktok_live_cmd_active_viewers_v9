#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

usage() {
  cat <<'EOF'
TikTok LIVE Event Middleware - Linux / Termux

Cách ngắn nhất:
  ./run.sh username

Tùy chọn:
  ./run.sh direct username
  ./run.sh game username

Ghi chú:
  - Linux/Termux: ưu tiên direct mode, không cần Chrome/DOM.
  - DOM mode hiện chưa hỗ trợ ở script này vì code DOM của repo đang dùng
    LOCALAPPDATA + Chrome profile theo Windows.
  - Termux thường dùng lệnh python; một số distro Linux có thể là python3.
    Nếu cần: PYTHON_BIN=python3 ./run.sh username
EOF
}

[ "$#" -gt 0 ] || { usage; exit 1; }

action=$1
shift || true

case "$action" in
  direct)
    [ "$#" -gt 0 ] || { usage; exit 1; }
    export COLLECTOR_MODE=direct
    exec node a.mjs "$@"
    ;;
  game)
    [ "$#" -gt 0 ] || { usage; exit 1; }
    export COLLECTOR_MODE=direct
    export GAME_EVENT_HOST="${GAME_EVENT_HOST:-127.0.0.1}"
    export GAME_EVENT_PORT="${GAME_EVENT_PORT:-9000}"
    export GAME_EVENT_PATH="${GAME_EVENT_PATH:-/tiktok-event}"
    export WEBHOOK_URLS="${WEBHOOK_URLS:-http://${GAME_EVENT_HOST}:${GAME_EVENT_PORT}${GAME_EVENT_PATH}}"
    "${PYTHON_BIN:-python}" scripts/send_webhook_handshake.py
    exec node a.mjs "$@"
    ;;
  dom|dom-visible|dom-hidden)
    echo "DOM mode hiện chỉ được repo cấu hình cho Windows (LOCALAPPDATA + Chrome profile)." >&2
    echo "Trên Linux/Termux hãy dùng: ./run.sh direct username" >&2
    exit 2
    ;;
  *)
    export COLLECTOR_MODE=direct
    exec node a.mjs "$action" "$@"
    ;;
esac
