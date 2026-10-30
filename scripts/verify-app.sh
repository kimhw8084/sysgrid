#!/usr/bin/env bash
set -euo pipefail

VERIFY_STAGE=all
if [[ $# -eq 2 && "$1" == "--stage" ]]; then
  VERIFY_STAGE="$2"
elif [[ $# -ne 0 ]]; then
  echo "Usage: verify-app.sh [--stage all|checks|normal-v1|desktop|role-matrix|root-preview]" >&2
  exit 2
fi
case "$VERIFY_STAGE" in
  all|checks|normal-v1|desktop|role-matrix|root-preview) ;;
  *) echo "Unknown application qualification stage: '$VERIFY_STAGE'." >&2; exit 2 ;;
esac
VERIFY_SHARD="${SYSGRID_VERIFY_SHARD:-}"
if [[ -n "$VERIFY_SHARD" ]]; then
  if [[ "$VERIFY_STAGE" != normal-v1 || ! "$VERIFY_SHARD" =~ ^[123]/3$ ]]; then
    echo "SYSGRID_VERIFY_SHARD requires --stage normal-v1 and one of 1/3, 2/3, 3/3." >&2
    exit 2
  fi
fi
if [[ "$VERIFY_STAGE" == all || "$VERIFY_STAGE" == root-preview ]]; then
  [[ -n "${SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID:-}" ]] || {
    echo "verify:app root-preview gate requires SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID; no identity is inferred." >&2
    exit 1
  }
fi

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

verify_runtime_resolve_python
verify_runtime_resolve_node
reset_generated_evidence
BACKEND_QUALIFICATION_ROOT=""
cleanup_backend_qualification() {
  if [[ -n "$BACKEND_QUALIFICATION_ROOT" && -f "$BACKEND_QUALIFICATION_ROOT/.sysgrid-owned" ]]; then
    rm -rf -- "$BACKEND_QUALIFICATION_ROOT"
  fi
  BACKEND_QUALIFICATION_ROOT=""
}
trap 'status=$?; cleanup_backend_qualification; verify_runtime_cleanup; exit "$status"' EXIT INT TERM

if [[ "$VERIFY_STAGE" == all || "$VERIFY_STAGE" == checks ]]; then
(
  cd "$ROOT_DIR"
  "$PYTHON_BIN" -m pytest -q \
    scripts/tests/test_safe_startup.py \
    scripts/tests/test_runtime_origin_config.py \
    scripts/tests/test_verify_runtime_ownership.py \
    scripts/tests/test_verify_runtime_node.py \
    scripts/tests/test_production_data_guard.py \
    scripts/tests/test_production_lifecycle.py \
    scripts/tests/test_production_preflight.py \
    scripts/tests/test_corporate_publishability_guard.py \
    scripts/tests/test_production_operations.py \
    scripts/tests/test_company_probe.py \
    scripts/tests/test_ci_shards.py \
    scripts/tests/test_verify_app_stages.py
  "$PYTHON_BIN" scripts/tests/test_application_ci_contract.py
  bash scripts/workstation-up.sh --self-test
)
fi

BACKEND_QUALIFICATION_TESTS=(
  test_migration_graph.py
  tests/test_database_isolation.py
  test_system_management_v1_policy.py
  test_chg13_authorization_security.py
  test_environment_identity.py
  test_rate_limit_identity.py
  test_device_secret_boundary.py
  test_firewall_integrity.py
  test_asset_write_boundary.py
  test_asset_stale_form.py
  test_asset_commands.py
  test_asset_write_migration.py
  test_asset_write_audit.py
  test_devices_api_edges.py
  test_asset_architecture_traceability.py
  test_hardware_integrity.py
  test_asset_link_integrity.py
  test_asset_date_integrity.py
  test_asset_scalar_integrity.py
  test_asset_import_integrity.py
  test_import_resource_limits.py
  test_asset_interface_integrity.py
  test_database_parameter_privacy.py
  test_validation_privacy.py
  tests/test_error_utils.py
  test_sync_authorization.py
  test_production_startup_policy.py
  test_runtime_diagnostics.py
  test_release_identity.py
  test_dashboard_metrics.py
  test_home_projection_integrity.py
  test_tenant_isolation.py
  test_tenant_workflows.py
  test_maintenance_integrity.py
  test_maintenance_window_lifecycle.py
  test_cross_module_integrations.py
  test_operational_actions.py
  test_settings_api_edges.py
  test_settings_deployment_boundary.py
  test_settings_legacy_boundary.py
  test_settings_workflows.py
  test_settings_operator_input_integrity.py
  test_settings_sync_preview_integrity.py
  test_monitoring_query_and_bulk_edges.py
  test_monitoring_restore_edges.py
  test_monitoring_workflows.py
  test_monitoring_history_authority.py
  test_monitoring_stale_form.py
  test_monitoring_edit_migration.py
  test_external_vendor_revision_migration.py
  test_monitoring_domain_contract.py
  test_monitoring_purge_authority.py
  tests/test_monitoring_helpers.py
  test_network_workflows.py
  test_network_endpoint_authorization.py
  test_network_import_authorization.py
  test_network_interface_integrity.py
  test_network_scalar_integrity.py
  test_network_create_audit.py
  test_network_noop_receipts.py
  test_network_custom_ip_edit.py
  test_network_batch_history.py
  test_network_legacy_edits.py
  test_network_table_edits.py
  test_service_workflows.py
  test_service_field_preservation.py
  test_service_relationship_authority.py
  test_service_import_integrity.py
  test_service_write_receipts.py
  test_service_stale_form.py
  test_service_bulk_concurrency.py
  test_service_edit_migration.py
  test_service_date_integrity.py
  test_service_value_integrity.py
  test_racks_api_edges.py
  test_rack_read_queries.py
  test_racks_workflows.py
  test_workspace_views.py
  test_workspace_team_views.py
  test_asset_vendor_bulk_workflows.py
  test_external_workflows.py
  test_projects_workflows.py
  tests/test_project_hierarchy.py
  tests/test_projects_workspace_saved_views.py
  test_pv1_domain_foundation.py
  test_p04_creation_portfolio_home.py
  test_p05_my_day_work_plan.py
  test_p06_schedule_core.py
  test_p06_timeline_scheduling.py
  test_p06_schedule_performance.py
  test_p07_architecture_engine.py
  test_p08_updates_resources_reports.py
  test_p09_outcomes_delivery_value.py
  test_p10_cross_cutting_hardening.py
  test_p11_project_portfolio_contract.py
  test_import_workflows.py
  test_revert_logic.py
  test_audit_integrity.py
)

BACKEND_QUALIFICATION_BATCH_SIZE=100
run_backend_qualification_pytest() {
  local temp_dir="$1"
  shift
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
      TMPDIR="$temp_dir" \
    "$PYTHON_BIN" -m pytest -q "$@"
  )
}

run_backend_qualification_batch() {
  local batch_number="$1"
  shift
  local batch_dir="$BACKEND_QUALIFICATION_ROOT/batch-$batch_number"
  local batch_status=0
  mkdir -p "$batch_dir"
  echo "Backend qualification batch $batch_number: $# collected test cases."
  if run_backend_qualification_pytest "$batch_dir" --basetemp="$batch_dir/pytest" "$@"; then
    :
  else
    batch_status=$?
  fi
  rm -rf -- "$batch_dir"
  return "$batch_status"
}

run_backend_qualification() {
  local collect_dir="$BACKEND_QUALIFICATION_ROOT/collect"
  local collection_output="$BACKEND_QUALIFICATION_ROOT/collection.txt"
  local item item_path selected_test found batch_number=0
  local -a backend_items=() batch_items=()
  mkdir -p "$collect_dir"
  if run_backend_qualification_pytest "$collect_dir" --collect-only --basetemp="$collect_dir/pytest" \
    "${BACKEND_QUALIFICATION_TESTS[@]}" >"$collection_output" 2>&1; then
    :
  else
    local collect_status=$?
    cat "$collection_output"
    return "$collect_status"
  fi

  while IFS= read -r item; do
    [[ "$item" == *::* ]] || continue
    item_path="${item%%::*}"
    found=false
    for selected_test in "${BACKEND_QUALIFICATION_TESTS[@]}"; do
      if [[ "$item_path" == "$selected_test" ]]; then
        found=true
        break
      fi
    done
    if [[ "$found" != true ]]; then
      echo "Backend collection returned an unselected test path: $item_path" >&2
      return 1
    fi
    backend_items+=("$item")
  done < "$collection_output"
  if [[ "${#backend_items[@]}" -eq 0 ]]; then
    echo "Backend qualification collected no test cases." >&2
    return 1
  fi
  for selected_test in "${BACKEND_QUALIFICATION_TESTS[@]}"; do
    found=false
    for item in "${backend_items[@]}"; do
      if [[ "${item%%::*}" == "$selected_test" ]]; then
        found=true
        break
      fi
    done
    if [[ "$found" != true ]]; then
      echo "Backend qualification collected no cases from $selected_test." >&2
      return 1
    fi
  done
  rm -rf -- "$collect_dir"

  for item in "${backend_items[@]}"; do
    batch_items+=("$item")
    if [[ "${#batch_items[@]}" -eq "$BACKEND_QUALIFICATION_BATCH_SIZE" ]]; then
      batch_number=$((batch_number + 1))
      run_backend_qualification_batch "$batch_number" "${batch_items[@]}"
      batch_items=()
    fi
  done
  if [[ "${#batch_items[@]}" -gt 0 ]]; then
    batch_number=$((batch_number + 1))
    run_backend_qualification_batch "$batch_number" "${batch_items[@]}"
  fi
}

if [[ "$VERIFY_STAGE" == all || "$VERIFY_STAGE" == checks ]]; then
  BACKEND_QUALIFICATION_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sysgrid-backend-qualification.XXXXXX")"
  : > "$BACKEND_QUALIFICATION_ROOT/.sysgrid-owned"
  run_backend_qualification
  cleanup_backend_qualification

(
  cd "$FRONTEND_DIR"
  node scripts/check-theme-preference.mjs
  node scripts/check-dev-server-boundary.mjs
  node scripts/check-desktop-test-selection.mjs
  node scripts/check-normal-release-selection.mjs
  node scripts/check-role-matrix-selection.mjs
  npm run check:operational-contracts
  npm run typecheck
  npm run test:coverage
  npm run build
)
fi

PLAYWRIGHT_BIN="$FRONTEND_DIR/node_modules/.bin/playwright"
if [[ "$VERIFY_STAGE" != checks && ! -x "$PLAYWRIGHT_BIN" ]]; then
  echo "Playwright is not installed at $PLAYWRIGHT_BIN. Install qualified dependencies before running verify:app; the gate will not install them." >&2
  exit 1
fi

for gate in normal-v1 desktop role-matrix root-preview; do
  [[ "$VERIFY_STAGE" == all || "$VERIFY_STAGE" == "$gate" ]] || continue
  VERIFY_RUNTIME_CLEANED="false"
  VERIFY_RUNTIME_DIR=""
  VERIFY_RUNTIME_BACKEND_PID=""
  VERIFY_RUNTIME_FRONTEND_PID=""
  export SYSGRID_VERIFY_PROFILE=normal-v1
  export SYSGRID_DESKTOP_ONLY=1
  case "$gate" in
    normal-v1) config=playwright.v1.config.ts ;;
    desktop) config=playwright.desktop.config.ts; export SYSGRID_DESKTOP_ONLY=1 ;;
    role-matrix) config=playwright.role-matrix.config.ts; export SYSGRID_VERIFY_PROFILE=role-matrix; export SYSGRID_DESKTOP_ONLY=1 ;;
    root-preview)
      config=playwright.root-preview.config.ts
      export SYSGRID_VERIFY_PROFILE=root-preview
      export SYSGRID_VERIFY_CONTROL_PLANE_ADMIN_USER_IDS="$SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID"
      ;;
  esac
  verify_runtime_start
  (
    cd "$FRONTEND_DIR"
    if [[ -n "$VERIFY_SHARD" ]]; then
      PLAYWRIGHT_JSON_OUTPUT_FILE="$FRONTEND_DIR/test-results/normal-v1-selection.json" \
        verify_runtime_run_command "$NODE_BIN" "$PLAYWRIGHT_BIN" test --config="$config" --list --reporter=json
      PLAYWRIGHT_JSON_OUTPUT_FILE="$FRONTEND_DIR/test-results/normal-v1-results.json" \
        verify_runtime_run_command "$NODE_BIN" "$PLAYWRIGHT_BIN" test --config="$config" \
          --shard="$VERIFY_SHARD" --reporter=list,html,json,./llm-reporter.ts
    else
      verify_runtime_run_command "$NODE_BIN" "$PLAYWRIGHT_BIN" test --config="$config"
    fi
  )
  verify_runtime_cleanup
done
echo "Application qualification stage completed: $VERIFY_STAGE"
