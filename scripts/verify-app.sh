#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
source "$ROOT_DIR/scripts/lib/verify-runtime.sh"

reset_generated_evidence() {
  rm -rf \
    "$BACKEND_DIR/test-results" \
    "$FRONTEND_DIR/test-results" \
    "$FRONTEND_DIR/test-results-v1" \
    "$FRONTEND_DIR/test-results-root-preview" \
    "$FRONTEND_DIR/playwright-report" \
    "$FRONTEND_DIR/blob-report"
  rm -f "$FRONTEND_DIR/llm-report.json"
  mkdir -p "$BACKEND_DIR/test-results" "$FRONTEND_DIR/test-results"
}

reset_generated_evidence
verify_runtime_resolve_python

BACKEND_QUALIFICATION_TESTS=(
  test_migration_graph.py
  test_system_management_v1_policy.py
  test_chg13_authorization_security.py
  test_runtime_diagnostics.py
  test_dashboard_metrics.py
  test_tenant_isolation.py
  test_tenant_workflows.py
  test_settings_api_edges.py
  test_settings_workflows.py
  test_monitoring_query_and_bulk_edges.py
  test_monitoring_restore_edges.py
  test_monitoring_workflows.py
  test_network_workflows.py
  test_service_workflows.py
  test_racks_api_edges.py
  test_racks_workflows.py
  test_workspace_views.py
  test_workspace_team_views.py
  test_asset_vendor_bulk_workflows.py
  test_import_workflows.py
  test_revert_logic.py
)

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
  "$PYTHON_BIN" -m pytest -q "${BACKEND_QUALIFICATION_TESTS[@]}"
)

(
  cd "$FRONTEND_DIR"
  npm run check:operational-contracts
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

(
  cd "$FRONTEND_DIR"
  verify_runtime_run_command \
    "$NODE_BIN" "$PLAYWRIGHT_BIN" test \
    --config=playwright.v1.config.ts
)

verify_runtime_cleanup
VERIFY_RUNTIME_CLEANED="false"
VERIFY_RUNTIME_DIR=""
VERIFY_RUNTIME_BACKEND_PID=""
VERIFY_RUNTIME_FRONTEND_PID=""
export SYSGRID_VERIFY_PROFILE="root-preview"
[[ -n "${SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID:-}" ]] || {
  echo "verify:app root-preview gate requires SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID; no identity is inferred." >&2
  exit 1
}
verify_runtime_start
(
  cd "$FRONTEND_DIR"
  verify_runtime_run_command \
    "$NODE_BIN" "$PLAYWRIGHT_BIN" test \
    --config=playwright.root-preview.config.ts
)
