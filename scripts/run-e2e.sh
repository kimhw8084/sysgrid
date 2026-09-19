#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
PLAYWRIGHT_BIN="$FRONTEND_DIR/node_modules/.bin/playwright"
source "$ROOT_DIR/scripts/lib/verify-runtime.sh"

[[ -x "$PLAYWRIGHT_BIN" ]] || {
  echo "Playwright is not installed at $PLAYWRIGHT_BIN. Install qualified dependencies before running E2E; the gate will not install them." >&2
  exit 1
}

trap 'status=$?; verify_runtime_cleanup; exit "$status"' EXIT INT TERM
verify_runtime_start
(
  cd "$FRONTEND_DIR"
  verify_runtime_run_command "$NODE_BIN" "$PLAYWRIGHT_BIN" test "$@"
)
