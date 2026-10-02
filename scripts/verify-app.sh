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
    "$FRONTEND_DIR/test-results-desktop" \
    "$FRONTEND_DIR/test-results-root-preview" \
    "$FRONTEND_DIR/playwright-report" \
    "$FRONTEND_DIR/playwright-report-desktop" \
    "$FRONTEND_DIR/blob-report"
  rm -f "$FRONTEND_DIR/llm-report.json"
  mkdir -p "$BACKEND_DIR/test-results" "$FRONTEND_DIR/test-results"
}

reset_generated_evidence
verify_runtime_resolve_python

(
  cd "$ROOT_DIR"
  "$PYTHON_BIN" -m pytest -q \
    scripts/tests/test_safe_startup.py \
    scripts/tests/test_runtime_origin_config.py \
    scripts/tests/test_production_data_guard.py \
    scripts/tests/test_production_lifecycle.py \
    scripts/tests/test_production_preflight.py
  bash scripts/workstation-up.sh --self-test
)

BACKEND_QUALIFICATION_TESTS=(
  test_migration_graph.py
  test_system_management_v1_policy.py
  test_chg13_authorization_security.py
  test_environment_identity.py
  test_rate_limit_identity.py
  test_device_secret_boundary.py
  test_database_parameter_privacy.py
  test_validation_privacy.py
  tests/test_error_utils.py
  test_sync_authorization.py
  test_production_startup_policy.py
  test_runtime_diagnostics.py
  test_dashboard_metrics.py
  test_tenant_isolation.py
  test_tenant_workflows.py
  test_maintenance_integrity.py
  test_maintenance_window_lifecycle.py
  test_cross_module_integrations.py
  test_operational_actions.py
  test_settings_api_edges.py
  test_settings_workflows.py
  test_monitoring_query_and_bulk_edges.py
  test_monitoring_restore_edges.py
  test_monitoring_workflows.py
  test_network_workflows.py
  test_service_workflows.py
  test_racks_api_edges.py
  test_rack_read_queries.py
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
  node scripts/check-theme-preference.mjs
  node scripts/check-dev-server-boundary.mjs
  node scripts/check-desktop-test-selection.mjs
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
export SYSGRID_VERIFY_PROFILE="normal-v1"
verify_runtime_start
(
  cd "$FRONTEND_DIR"
  SYSGRID_DESKTOP_ONLY=1 verify_runtime_run_command \
    "$NODE_BIN" "$PLAYWRIGHT_BIN" test \
    --config=playwright.desktop.config.ts
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
export SYSGRID_VERIFY_CONTROL_PLANE_ADMIN_USER_IDS="$SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID"
verify_runtime_start
(
  cd "$FRONTEND_DIR"
  verify_runtime_run_command \
    "$NODE_BIN" "$PLAYWRIGHT_BIN" test \
    --config=playwright.root-preview.config.ts
)
