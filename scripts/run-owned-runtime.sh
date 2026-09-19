#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/verify-runtime.sh"

if [[ "$#" -eq 0 ]]; then
  echo "Usage: scripts/run-owned-runtime.sh -- command [args...]" >&2
  exit 2
fi
if [[ "${1:-}" == "--" ]]; then
  shift
fi
if [[ "$#" -eq 0 ]]; then
  echo "Usage: scripts/run-owned-runtime.sh -- command [args...]" >&2
  exit 2
fi

trap 'status=$?; verify_runtime_cleanup; exit "$status"' EXIT INT TERM
verify_runtime_start
verify_runtime_run_command "$@"
