#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
export SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID="${SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID:-haewon.kim}"
source "$ROOT_DIR/scripts/lib/verify-runtime.sh"

reset_generated_evidence() {
  rm -rf \
    "$BACKEND_DIR/test-results" \
    "$FRONTEND_DIR/test-results" \
    "$FRONTEND_DIR/playwright-report" \
    "$FRONTEND_DIR/blob-report"
  rm -f "$FRONTEND_DIR/llm-report.json"
  mkdir -p "$BACKEND_DIR/test-results" "$FRONTEND_DIR/test-results"
}

reset_generated_evidence
verify_runtime_resolve_python

trap 'status=$?; verify_runtime_cleanup; exit "$status"' EXIT INT TERM

(
  cd "$BACKEND_DIR"
  env \
    -u CONFIG_DATABASE_URL \
    -u DATABASE_URL \
    -u TENANT_STORAGE_ROOT \
    -u DEFAULT_TENANT_NAME \
    -u PUBLIC_READONLY_ENABLED \
    -u DEFAULT_USER_ID \
    -u AUTO_ADMIN_USER_IDS \
    -u USER_ID_ENV_VAR \
    -u SYSGRID_VERIFY_RUNTIME_USER_ID \
    -u SYSGRID_VERIFY_USER_ID \
    -u USER_ID \
    -u user_name \
    -u DEFAULT_EMAIL_DOMAIN \
    -u ENVIRONMENT \
    -u TESTING \
    -u ALLOWED_HOSTS \
    -u BACKEND_CORS_ORIGINS \
    -u IDENTITY_MODE \
    -u TRUSTED_PROXY_USER_HEADER \
  "$PYTHON_BIN" -m pytest
)

(
  cd "$FRONTEND_DIR"
  npm run test:lint
  npm run typecheck
  npm run test:coverage
  npm run build
)

verify_runtime_start

PLAYWRIGHT_BIN="$FRONTEND_DIR/node_modules/.bin/playwright"
[[ -x "$PLAYWRIGHT_BIN" ]] || {
  echo "Playwright is not installed at $PLAYWRIGHT_BIN. Install qualified dependencies before running verify:app; the gate will not install them." >&2
  exit 1
}

verify_runtime_run_command \
  "$NODE_BIN" "$PLAYWRIGHT_BIN" test \
  tests/sentinel_comprehensive.spec.ts \
  tests/external-services-bulk-preview.spec.ts \
  tests/assets-vendors-bulk-preview.spec.ts \
  tests/shell-and-search.spec.ts \
  tests/view-deeplink-matrix.spec.ts \
  tests/view-empty-states.spec.ts \
  tests/blank-slate-audit.spec.ts
