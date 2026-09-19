#!/usr/bin/env bash

set -euo pipefail

VERIFY_RUNTIME_ROOT_DIR="${VERIFY_RUNTIME_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
VERIFY_RUNTIME_BACKEND_DIR="$VERIFY_RUNTIME_ROOT_DIR/backend"
VERIFY_RUNTIME_FRONTEND_DIR="$VERIFY_RUNTIME_ROOT_DIR/frontend"
VERIFY_RUNTIME_BACKEND_HOST="${SYSGRID_VERIFY_BACKEND_HOST:-127.0.0.1}"
VERIFY_RUNTIME_FRONTEND_HOST="${SYSGRID_VERIFY_FRONTEND_HOST:-127.0.0.1}"
VERIFY_RUNTIME_PROFILE="${SYSGRID_VERIFY_PROFILE:-normal-v1}"
VERIFY_RUNTIME_TEST_USER="${SYSGRID_VERIFY_USER_ID:-haewon.kim}"
VERIFY_RUNTIME_TEST_TENANT="${SYSGRID_VERIFY_TENANT_ID:-1}"
VERIFY_RUNTIME_SYSTEM_ROOT=""
VERIFY_RUNTIME_USER_ENV_VAR="SYSGRID_VERIFY_RUNTIME_USER_ID"
VERIFY_RUNTIME_BACKEND_PID=""
VERIFY_RUNTIME_FRONTEND_PID=""
VERIFY_RUNTIME_DIR=""
VERIFY_RUNTIME_CLEANED="false"
PYTHON_BIN="${PYTHON_BIN:-}"
NODE_BIN="${NODE_BIN:-}"

verify_runtime_configure_profile() {
  VERIFY_RUNTIME_PROFILE="${SYSGRID_VERIFY_PROFILE:-normal-v1}"
  case "$VERIFY_RUNTIME_PROFILE" in
    normal-v1)
      VERIFY_RUNTIME_SYSTEM_ROOT=""
      VERIFY_RUNTIME_TEST_USER="${SYSGRID_VERIFY_USER_ID:-haewon.kim}"
      ;;
    root-preview)
      [[ -n "${SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID:-}" ]] || {
        echo "root-preview requires SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID; identity is never inferred from a username." >&2
        return 1
      }
      VERIFY_RUNTIME_SYSTEM_ROOT="$SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID"
      VERIFY_RUNTIME_TEST_USER="${SYSGRID_VERIFY_USER_ID:-$VERIFY_RUNTIME_SYSTEM_ROOT}"
      [[ "$VERIFY_RUNTIME_TEST_USER" == "$VERIFY_RUNTIME_SYSTEM_ROOT" ]] || {
        echo "root-preview requires SYSGRID_VERIFY_USER_ID to equal the configured System Root identity." >&2
        return 1
      }
      ;;
    *)
      echo "Unsupported SYSGRID_VERIFY_PROFILE '$VERIFY_RUNTIME_PROFILE'. Use normal-v1 or root-preview." >&2
      return 1
      ;;
  esac
  export VERIFY_RUNTIME_PROFILE VERIFY_RUNTIME_TEST_USER VERIFY_RUNTIME_SYSTEM_ROOT
}

verify_runtime_resolve_python() {
  if [[ -n "$PYTHON_BIN" ]]; then
    return 0
  fi

  local candidates=()
  local repository_python="$VERIFY_RUNTIME_BACKEND_DIR/venv/bin/python"
  local candidate
  local dependency_error

  if [[ -n "${SYSGRID_VERIFY_PYTHON:-}" ]]; then
    candidates+=("$SYSGRID_VERIFY_PYTHON")
  elif [[ -x "$repository_python" ]]; then
    candidates+=("$repository_python")
  fi

  if [[ -z "${SYSGRID_VERIFY_PYTHON:-}" && ! -x "$repository_python" ]]; then
    for candidate in python3 python; do
      if command -v "$candidate" >/dev/null 2>&1; then
        candidates+=("$(command -v "$candidate")")
      fi
    done
  fi

  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate" ]] || continue
    if dependency_error="$($candidate - <<'PY' 2>&1
import importlib.util
required = ("pytest", "alembic", "sqlalchemy", "aiosqlite", "fastapi", "uvicorn")
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    raise SystemExit("missing imports: " + ", ".join(missing))
PY
)"; then
      PYTHON_BIN="$candidate"
      export PYTHON_BIN
      echo "Verification Python: $PYTHON_BIN ($($PYTHON_BIN --version 2>&1))"
      return 0
    fi
    echo "Python candidate rejected: $candidate — $dependency_error" >&2
  done

  cat >&2 <<'EOF'
No usable verification Python was found. Set SYSGRID_VERIFY_PYTHON to an interpreter that can import:
pytest, alembic, sqlalchemy, aiosqlite, fastapi, uvicorn.
Qualification does not install packages automatically.
EOF
  return 1
}

verify_runtime_resolve_node() {
  if [[ -n "$NODE_BIN" ]]; then
    echo "Verification Node: $NODE_BIN ($($NODE_BIN --version 2>&1))"
    return 0
  fi

  local candidates=()
  local candidate
  if [[ -n "${SYSGRID_VERIFY_NODE:-}" ]]; then
    candidates+=("$SYSGRID_VERIFY_NODE")
  else
    while IFS= read -r candidate; do
      [[ -n "$candidate" ]] && candidates+=("$candidate")
    done < <(type -ap node 2>/dev/null || true)
  fi

  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate" ]] || continue
    if "$candidate" --version >/dev/null 2>&1; then
      NODE_BIN="$candidate"
      export NODE_BIN
      echo "Verification Node: $NODE_BIN ($($NODE_BIN --version 2>&1))"
      return 0
    fi
    echo "Node candidate rejected: $candidate" >&2
  done

  echo "No usable verification Node was found. Set SYSGRID_VERIFY_NODE to a Node interpreter." >&2
  return 1
}

verify_runtime_assert_port_free() {
  local port="$1"
  local label="$2"
  if ! "$PYTHON_BIN" - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
PY
  then
    echo "Refusing to reuse an unmanaged $label listener on port $port." >&2
    echo "Set an unused port override or let the canonical runtime allocate one." >&2
    return 1
  fi
}

verify_runtime_allocate_port() {
  "$PYTHON_BIN" - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

verify_runtime_select_port() {
  local configured="$1"
  local label="$2"
  local selected
  if [[ -n "$configured" ]]; then
    selected="$configured"
    verify_runtime_assert_port_free "$selected" "$label"
  else
    selected="$(verify_runtime_allocate_port)"
    verify_runtime_assert_port_free "$selected" "$label"
  fi
  printf '%s' "$selected"
}

verify_runtime_terminate_process_tree() {
  local pid="$1"
  local child
  while read -r child; do
    [[ -n "$child" ]] && verify_runtime_terminate_process_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill "$pid" >/dev/null 2>&1 || true
}

verify_runtime_wait_for_url() {
  local url="$1"
  local label="$2"
  local attempt
  for attempt in {1..90}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $label at $url" >&2
  return 1
}

verify_runtime_prepare_environment() {
  VERIFY_RUNTIME_ENV=(
    env
    -u TESTING
    -u USER_ID
    -u user_name
    -u SYSGRID_VERIFY_USER_ID
    -u TRUSTED_PROXY_USER_HEADER
    "CONFIG_DATABASE_URL=sqlite+aiosqlite:///$VERIFY_RUNTIME_CONFIG_DB"
    "DATABASE_URL=sqlite+aiosqlite:///$VERIFY_RUNTIME_TENANT_DB"
    "TENANT_STORAGE_ROOT=$VERIFY_RUNTIME_TENANT_ROOT"
    "DEFAULT_TENANT_NAME=Playwright Gate"
    "PUBLIC_READONLY_ENABLED=false"
    "DEFAULT_USER_ID=$VERIFY_RUNTIME_TEST_USER"
    "AUTO_ADMIN_USER_IDS=$VERIFY_RUNTIME_TEST_USER"
    "SYSTEM_ROOT_USER_IDS=$VERIFY_RUNTIME_SYSTEM_ROOT"
    "SYSGRID_VERIFY_PROFILE=$VERIFY_RUNTIME_PROFILE"
    "USER_ID_ENV_VAR=$VERIFY_RUNTIME_USER_ENV_VAR"
    "$VERIFY_RUNTIME_USER_ENV_VAR=$VERIFY_RUNTIME_TEST_USER"
    "DEFAULT_EMAIL_DOMAIN=sysgrid.test"
    "ENVIRONMENT=development"
    "IDENTITY_MODE=development"
    "ALLOWED_HOSTS=$VERIFY_RUNTIME_BACKEND_HOST,localhost,test,testserver"
    "BACKEND_CORS_ORIGINS=$VERIFY_RUNTIME_FRONTEND_ORIGIN"
  )
}

verify_runtime_prepare_disposable_data() {
  mkdir -p "$VERIFY_RUNTIME_TENANT_ROOT"

  echo "Running the repository migration entry path against a fresh tenant database..."
  (
    cd "$VERIFY_RUNTIME_BACKEND_DIR"
    "${VERIFY_RUNTIME_ENV[@]}" SQLALCHEMY_DATABASE_URL="sqlite:///$VERIFY_RUNTIME_TENANT_DB" \
      "$PYTHON_BIN" "$VERIFY_RUNTIME_ROOT_DIR/scripts/run-alembic.py" upgrade head
  )

  echo "Seeding isolated Playwright tenant..."
  (
    cd "$VERIFY_RUNTIME_ROOT_DIR"
    "${VERIFY_RUNTIME_ENV[@]}" "$PYTHON_BIN" seed.py \
      --tenant-name "Playwright Gate" \
      --tenant-db "$VERIFY_RUNTIME_TENANT_DB_REL" \
      --admin-user "$VERIFY_RUNTIME_TEST_USER" \
      --no-seed-data
  )

  echo "Provisioning code-managed reference data..."
  (
    cd "$VERIFY_RUNTIME_BACKEND_DIR"
    "${VERIFY_RUNTIME_ENV[@]}" "$PYTHON_BIN" -m app.reference_data
  )

  if [[ "$VERIFY_RUNTIME_PROFILE" == "root-preview" ]]; then
    echo "Provisioning explicit System Root preview capabilities for $VERIFY_RUNTIME_SYSTEM_ROOT..."
    (
      cd "$VERIFY_RUNTIME_BACKEND_DIR"
      "${VERIFY_RUNTIME_ENV[@]}" "$PYTHON_BIN" - <<'PY'
import asyncio
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.models import Operator
from app.core.config import settings


async def main() -> None:
    catalog_path = Path.cwd().parent / "contracts" / "system_management_v1.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    capabilities = {
        str(module["required_capability"]): 3
        for module in catalog["modules"]
        if module.get("required_capability")
        and module.get("default_stage") == "preview"
        and module.get("root_preview_allowed") is True
    }
    capabilities["diagnostics"] = 1
    engine = create_async_engine(settings.DATABASE_URL)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        operator = await session.scalar(
            select(Operator).where(Operator.username == settings.DEFAULT_USER_ID)
        )
        if operator is None:
            raise RuntimeError(f"Seeded System Root operator not found: {settings.DEFAULT_USER_ID}")
        operator.custom_permissions = capabilities
        await session.commit()
    await engine.dispose()


asyncio.run(main())
PY
    )
  fi
}

verify_runtime_start_backend() {
  (
    cd "$VERIFY_RUNTIME_BACKEND_DIR"
    exec "${VERIFY_RUNTIME_ENV[@]}" "$PYTHON_BIN" -m uvicorn app.main:app \
      --host "$VERIFY_RUNTIME_BACKEND_HOST" --port "$VERIFY_RUNTIME_BACKEND_PORT"
  ) >"$VERIFY_RUNTIME_LOG_DIR/backend.log" 2>&1 &
  VERIFY_RUNTIME_BACKEND_PID=$!
  verify_runtime_wait_for_url "$VERIFY_RUNTIME_BACKEND_URL" "isolated backend"
}

verify_runtime_start_frontend() {
  local vite_entry="$VERIFY_RUNTIME_FRONTEND_DIR/node_modules/vite/bin/vite.js"
  [[ -f "$vite_entry" ]] || {
    echo "Vite is not installed at $vite_entry. Install qualified dependencies before running verification; the gate will not install them." >&2
    return 1
  }
  (
    cd "$VERIFY_RUNTIME_FRONTEND_DIR"
    VITE_API_BASE_URL="$VERIFY_RUNTIME_BACKEND_ORIGIN" \
    VITE_FRONTEND_ORIGIN="$VERIFY_RUNTIME_FRONTEND_ORIGIN" \
    "$NODE_BIN" "$vite_entry" \
      --host "$VERIFY_RUNTIME_FRONTEND_HOST" --port "$VERIFY_RUNTIME_FRONTEND_PORT" --strictPort
  ) >"$VERIFY_RUNTIME_LOG_DIR/frontend.log" 2>&1 &
  VERIFY_RUNTIME_FRONTEND_PID=$!
  verify_runtime_wait_for_url "$VERIFY_RUNTIME_FRONTEND_URL" "isolated frontend"
}

verify_runtime_assert_clean_fixture() {
  local headers=(-H "X-User-Id: $VERIFY_RUNTIME_TEST_USER" -H "X-Tenant-Id: $VERIFY_RUNTIME_TEST_TENANT")
  local tenants devices services monitoring reference_options

  tenants="$(curl -fsS "${headers[@]}" "$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1/tenants/me")"
  [[ "$tenants" == *'"id":1'* && "$tenants" == *'"name":"Playwright Gate"'* && "$tenants" == *'"is_selected":true'* ]] || {
    echo "Disposable tenant contract failed: $tenants" >&2
    return 1
  }

  devices="$(curl -fsS "${headers[@]}" "$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1/devices?include_deleted=true")"
  services="$(curl -fsS "${headers[@]}" "$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1/logical-services?include_deleted=true")"
  monitoring="$(curl -fsS "${headers[@]}" "$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1/monitoring?include_deleted=true")"
  reference_options="$(curl -fsS "${headers[@]}" "$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1/settings/options")"

  printf '%s' "$reference_options" | "$PYTHON_BIN" -c '
import json
import sys

rows = json.load(sys.stdin)
observed = {(str(row.get("category")), str(row.get("value"))) for row in rows}
required = {
    ("MonitoringCategory", "Hardware"),
    ("MonitoringPlatform", "Zabbix"),
    ("NotificationMethod", "Slack"),
    ("MonitoringSeverity", "Critical"),
    ("MonitoringOwnerRole", "Primary Support"),
}
missing = sorted(required - observed)
if missing:
    raise SystemExit(f"Missing code-managed reference options: {missing}")
'

  [[ "$devices" == "[]" ]] || { echo "Expected zero seeded devices, observed: $devices" >&2; return 1; }
  [[ "$services" == "[]" ]] || { echo "Expected zero seeded services, observed: $services" >&2; return 1; }
  [[ "$monitoring" == "[]" ]] || { echo "Expected zero seeded monitoring records, observed: $monitoring" >&2; return 1; }

  echo "Disposable Playwright fixture contract passed: one tenant, code-managed reference data, zero domain rows."
}

verify_runtime_start() {
  verify_runtime_configure_profile
  verify_runtime_resolve_python
  verify_runtime_resolve_node

  local temp_parent="${SYSGRID_VERIFY_TEMP_ROOT:-${TMPDIR:-/tmp}}"
  mkdir -p "$temp_parent"
  VERIFY_RUNTIME_DIR="$(mktemp -d "$temp_parent/sysgrid-verify.XXXXXX")"
  VERIFY_RUNTIME_LOG_DIR="$VERIFY_RUNTIME_DIR/logs"
  VERIFY_RUNTIME_CONFIG_DB="$VERIFY_RUNTIME_DIR/config.db"
  VERIFY_RUNTIME_TENANT_DB="$VERIFY_RUNTIME_DIR/tenant.db"
  VERIFY_RUNTIME_TENANT_ROOT="$VERIFY_RUNTIME_DIR/tenants"
  VERIFY_RUNTIME_TENANT_DB_REL="$VERIFY_RUNTIME_TENANT_DB"
  VERIFY_RUNTIME_BACKEND_PORT="$(verify_runtime_select_port "${SYSGRID_VERIFY_BACKEND_PORT:-}" backend)"
  VERIFY_RUNTIME_FRONTEND_PORT="$(verify_runtime_select_port "${SYSGRID_VERIFY_FRONTEND_PORT:-}" frontend)"
  VERIFY_RUNTIME_BACKEND_ORIGIN="http://$VERIFY_RUNTIME_BACKEND_HOST:$VERIFY_RUNTIME_BACKEND_PORT"
  VERIFY_RUNTIME_FRONTEND_ORIGIN="http://$VERIFY_RUNTIME_FRONTEND_HOST:$VERIFY_RUNTIME_FRONTEND_PORT"
  VERIFY_RUNTIME_BACKEND_URL="$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1/health"
  VERIFY_RUNTIME_FRONTEND_URL="$VERIFY_RUNTIME_FRONTEND_ORIGIN"
  mkdir -p "$VERIFY_RUNTIME_LOG_DIR"
  verify_runtime_prepare_environment

  export SYSGRID_VERIFY_BACKEND_ORIGIN="$VERIFY_RUNTIME_BACKEND_ORIGIN"
  export SYSGRID_VERIFY_FRONTEND_ORIGIN="$VERIFY_RUNTIME_FRONTEND_ORIGIN"
  export SYSGRID_VERIFY_BACKEND_PORT="$VERIFY_RUNTIME_BACKEND_PORT"
  export SYSGRID_VERIFY_FRONTEND_PORT="$VERIFY_RUNTIME_FRONTEND_PORT"
  export SYSGRID_VERIFY_RUNTIME_DIR="$VERIFY_RUNTIME_DIR"
  export SYSGRID_VERIFY_ROOT_DIR="$VERIFY_RUNTIME_ROOT_DIR"
  export SYSGRID_VERIFY_TENANT_DB="$VERIFY_RUNTIME_TENANT_DB"
  export SYSGRID_VERIFY_PYTHON_BIN="$PYTHON_BIN"
  export PLAYWRIGHT_BASE_URL="$VERIFY_RUNTIME_FRONTEND_ORIGIN"
  export PW_API_BASE="$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1"
  export PW_TENANT_ID="$VERIFY_RUNTIME_TEST_TENANT"

  verify_runtime_prepare_disposable_data
  verify_runtime_start_backend
  verify_runtime_assert_clean_fixture
  verify_runtime_start_frontend
  echo "Owned verification runtime ready: profile=$VERIFY_RUNTIME_PROFILE backend=$VERIFY_RUNTIME_BACKEND_ORIGIN frontend=$VERIFY_RUNTIME_FRONTEND_ORIGIN logs=$VERIFY_RUNTIME_LOG_DIR"
}

verify_runtime_run_command() {
  local command_status=0
  "${VERIFY_RUNTIME_ENV[@]}" \
    PW_API_BASE="$VERIFY_RUNTIME_BACKEND_ORIGIN/api/v1" \
    PW_TENANT_ID="$VERIFY_RUNTIME_TEST_TENANT" \
    USER_ID="$VERIFY_RUNTIME_TEST_USER" \
    PLAYWRIGHT_BASE_URL="$VERIFY_RUNTIME_FRONTEND_ORIGIN" \
    "$@" || command_status=$?
  return "$command_status"
}

verify_runtime_cleanup() {
  [[ "$VERIFY_RUNTIME_CLEANED" == "true" ]] && return 0
  VERIFY_RUNTIME_CLEANED="true"
  if [[ -n "$VERIFY_RUNTIME_FRONTEND_PID" ]] && kill -0 "$VERIFY_RUNTIME_FRONTEND_PID" 2>/dev/null; then
    verify_runtime_terminate_process_tree "$VERIFY_RUNTIME_FRONTEND_PID"
  fi
  if [[ -n "$VERIFY_RUNTIME_BACKEND_PID" ]] && kill -0 "$VERIFY_RUNTIME_BACKEND_PID" 2>/dev/null; then
    verify_runtime_terminate_process_tree "$VERIFY_RUNTIME_BACKEND_PID"
  fi
  if [[ -n "$VERIFY_RUNTIME_DIR" ]]; then
    if [[ "${SYSGRID_VERIFY_KEEP_LOGS:-0}" == "1" ]]; then
      echo "Retaining owned runtime logs at $VERIFY_RUNTIME_LOG_DIR" >&2
    else
      rm -rf "$VERIFY_RUNTIME_DIR"
    fi
  fi
}
