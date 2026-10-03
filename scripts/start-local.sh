#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/safe-startup.sh"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
PYTHON_BIN="${PYTHON_BIN:-python3}"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
API_BASE_URL="${API_BASE_URL:-}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-}"
DEFAULT_USER_ID_VALUE="${DEFAULT_USER_ID_VALUE:-haewon.kim}"
AUTO_ADMIN_USER_IDS_VALUE="${AUTO_ADMIN_USER_IDS_VALUE:-$DEFAULT_USER_ID_VALUE}"
ADMIN_FULL_NAME="${ADMIN_FULL_NAME:-Haewon Kim}"
ADMIN_EMAIL="${ADMIN_EMAIL:-haewon.kim@sysgrid.local}"
ADMIN_DEPARTMENT="${ADMIN_DEPARTMENT:-Infrastructure}"
USER_ID_ENV_VAR_VALUE="${USER_ID_ENV_VAR_VALUE:-USER_ID}"
RUNTIME_EFFECTIVE_USER_ID="${RUNTIME_EFFECTIVE_USER_ID:-}"
SEED_DOMAIN_DATA="${SEED_DOMAIN_DATA:-false}"
DATA_MODE="${DATA_MODE:-preserve}"
RESET_DATA_EXPLICIT="false"
RUN_TYPECHECK="${RUN_TYPECHECK:-true}"
STRICT_STARTUP_CHECKS="${STRICT_STARTUP_CHECKS:-false}"
PRINT_RUNTIME_CONFIG="${PRINT_RUNTIME_CONFIG:-false}"
BUGANIZER_URL="${BUGANIZER_URL:-}"
EXISTING_ALLOWED_HOSTS="${ALLOWED_HOSTS:-}"
EXISTING_CORS_ORIGINS="${BACKEND_CORS_ORIGINS:-}"
RUNTIME_LOG_DIR="${RUNTIME_LOG_DIR:-}"
RUNTIME_REPORT_FILE="${RUNTIME_REPORT_FILE:-}"
PROFILE_NAME="${PROFILE_NAME:-default}"
PUBLIC_FRONTEND_PROBE="${PUBLIC_FRONTEND_PROBE:-true}"
REQUIRE_PUBLIC_FRONTEND="${REQUIRE_PUBLIC_FRONTEND:-false}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/start-local.sh [options]

Starts a development/UAT SysGrid environment and supports localhost, VS Code
forwarded ports, company proxy origins, explicit remote development origins,
and either a fresh disposable seed or a preserved Local Demo database.

Options:
  --backend-host <host>              Local bind host for the backend
  --backend-port <port>              Local backend port
  --frontend-host <host>             Local bind host for Vite
  --frontend-port <port>             Local frontend port
  --api-base-url <origin>            Browser-visible backend origin, no /api/v1
  --frontend-origin <origin>         Browser-visible frontend origin
  --default-user-id <userId>
  --auto-admin-user-ids <csv>
  --admin-full-name <name>
  --admin-email <email>
  --admin-department <department>
  --user-id-env-var <envVarName>
  --runtime-effective-user-id <userId>
  --buganizer-url <url>              Optional company Buganizer/new-issue URL
  --seed-data                        Include representative data on first initialization
  --no-seed-data                     Seed only foundation data on first initialization (default)
  --reset-data                       Archive old Local Demo data and initialize fresh databases
  --preserve-data                    Reuse existing data; initialize when absent (default)
  --runtime-log-dir <directory>      Persist backend/frontend/typecheck logs
  --runtime-report-file <path>       Write a machine-readable runtime JSON report
  --profile-name <name>              UAT/workstation profile name for evidence
  --skip-public-frontend-probe       Do not probe browser-visible frontend URL
  --require-public-frontend          Fail if browser-visible frontend probe fails
  --skip-typecheck
  --strict-checks
  --print-runtime-config             Resolve and print host/CORS config, then exit
  --help

Examples:
  ./scripts/start-local.sh

  ./scripts/start-local.sh \
    --api-base-url http://8000.vscode.company.example/ \
    --frontend-origin http://5173.vscode.company.example/ \
    --user-id-env-var AccessKey \
    --runtime-effective-user-id haewon.kim \
    --seed-data \
    --strict-checks

  ./scripts/start-local.sh \
    --api-base-url http://8000.vscode.company.example/ \
    --frontend-origin http://5173.vscode.company.example/ \
    --preserve-data
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-host) BACKEND_HOST="$2"; shift 2 ;;
    --backend-port) BACKEND_PORT="$2"; shift 2 ;;
    --frontend-host) FRONTEND_HOST="$2"; shift 2 ;;
    --frontend-port) FRONTEND_PORT="$2"; shift 2 ;;
    --api-base-url) API_BASE_URL="$2"; shift 2 ;;
    --frontend-origin) FRONTEND_ORIGIN="$2"; shift 2 ;;
    --default-user-id) DEFAULT_USER_ID_VALUE="$2"; shift 2 ;;
    --auto-admin-user-ids) AUTO_ADMIN_USER_IDS_VALUE="$2"; shift 2 ;;
    --admin-full-name) ADMIN_FULL_NAME="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-department) ADMIN_DEPARTMENT="$2"; shift 2 ;;
    --user-id-env-var) USER_ID_ENV_VAR_VALUE="$2"; shift 2 ;;
    --runtime-effective-user-id) RUNTIME_EFFECTIVE_USER_ID="$2"; shift 2 ;;
    --buganizer-url) BUGANIZER_URL="$2"; shift 2 ;;
    --seed-data) SEED_DOMAIN_DATA="true"; shift ;;
    --no-seed-data) SEED_DOMAIN_DATA="false"; shift ;;
    --reset-data) DATA_MODE="reset"; RESET_DATA_EXPLICIT="true"; shift ;;
    --preserve-data) DATA_MODE="preserve"; shift ;;
    --runtime-log-dir) RUNTIME_LOG_DIR="$2"; shift 2 ;;
    --runtime-report-file) RUNTIME_REPORT_FILE="$2"; shift 2 ;;
    --profile-name) PROFILE_NAME="$2"; shift 2 ;;
    --skip-public-frontend-probe) PUBLIC_FRONTEND_PROBE="false"; shift ;;
    --require-public-frontend) PUBLIC_FRONTEND_PROBE="true"; REQUIRE_PUBLIC_FRONTEND="true"; shift ;;
    --skip-typecheck) RUN_TYPECHECK="false"; shift ;;
    --strict-checks) STRICT_STARTUP_CHECKS="true"; shift ;;
    --print-runtime-config) PRINT_RUNTIME_CONFIG="true"; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$DATA_MODE" in
  reset|preserve) ;;
  *) echo "Invalid DATA_MODE: $DATA_MODE (expected reset or preserve)" >&2; exit 1 ;;
esac

if [[ "$DATA_MODE" == "reset" && "$RESET_DATA_EXPLICIT" != "true" ]]; then
  echo "Reset requires an explicit --reset-data argument; environment defaults cannot reset data." >&2
  exit 1
fi

for port_value in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  [[ "$port_value" =~ ^[0-9]+$ ]] && (( port_value >= 1 && port_value <= 65535 )) || {
    echo "Invalid port: $port_value" >&2
    exit 1
  }
done

command -v "$PYTHON_BIN" >/dev/null 2>&1 || {
  echo "Missing Python interpreter: $PYTHON_BIN" >&2
  exit 1
}

if [[ -z "$API_BASE_URL" ]]; then
  API_BASE_URL="http://$BACKEND_HOST:$BACKEND_PORT"
fi
if [[ -z "$FRONTEND_ORIGIN" ]]; then
  FRONTEND_ORIGIN="http://$FRONTEND_HOST:$FRONTEND_PORT"
fi

origin_source_policy="enforce"
[[ "$PRINT_RUNTIME_CONFIG" == "true" ]] && origin_source_policy="inspect"
runtime_assignments="$(
  "$PYTHON_BIN" "$ROOT_DIR/scripts/runtime_origin_config.py" \
    --source-policy "$origin_source_policy" \
    --api-base-url "$API_BASE_URL" \
    --frontend-origin "$FRONTEND_ORIGIN" \
    --backend-host "$BACKEND_HOST" \
    --backend-port "$BACKEND_PORT" \
    --frontend-host "$FRONTEND_HOST" \
    --frontend-port "$FRONTEND_PORT" \
    --allowed-hosts "$EXISTING_ALLOWED_HOSTS" \
    --cors-origins "$EXISTING_CORS_ORIGINS" \
    --format shell
)"
eval "$runtime_assignments"
export API_BASE_URL FRONTEND_ORIGIN ALLOWED_HOSTS BACKEND_CORS_ORIGINS

if [[ -z "$RUNTIME_EFFECTIVE_USER_ID" ]]; then
  RUNTIME_EFFECTIVE_USER_ID="${!USER_ID_ENV_VAR_VALUE:-}"
fi
SOURCE_OF_TRUTH_USER_ID="${RUNTIME_EFFECTIVE_USER_ID:-$DEFAULT_USER_ID_VALUE}"
if [[ -n "$RUNTIME_EFFECTIVE_USER_ID" && ",$AUTO_ADMIN_USER_IDS_VALUE," != *",$RUNTIME_EFFECTIVE_USER_ID,"* ]]; then
  AUTO_ADMIN_USER_IDS_VALUE="${AUTO_ADMIN_USER_IDS_VALUE},$RUNTIME_EFFECTIVE_USER_ID"
fi

if [[ -n "$RUNTIME_LOG_DIR" ]]; then
  mkdir -p "$RUNTIME_LOG_DIR"
  RUNTIME_LOG_DIR="$(cd "$RUNTIME_LOG_DIR" && pwd)"
fi
if [[ -n "$RUNTIME_REPORT_FILE" ]]; then
  mkdir -p "$(dirname "$RUNTIME_REPORT_FILE")"
fi

print_runtime_summary() {
  cat <<EOF_SUMMARY

RESOLVED SYSGRID DEVELOPMENT/UAT RUNTIME
----------------------------------------
Profile:                  $PROFILE_NAME
Data mode:                $DATA_MODE
Seed representative data: $SEED_DOMAIN_DATA
Local backend bind:       http://$BACKEND_HOST:$BACKEND_PORT
Browser API origin:       $API_BASE_URL
Trusted API hostname:     $API_PUBLIC_HOSTNAME
Local frontend bind:      http://$FRONTEND_HOST:$FRONTEND_PORT
Browser frontend origin:  $FRONTEND_ORIGIN
Allowed hosts:            $ALLOWED_HOSTS
Allowed CORS origins:     $BACKEND_CORS_ORIGINS
Health check:             $PUBLIC_HEALTH_URL
User identity variable:   $USER_ID_ENV_VAR_VALUE
Effective user:           $SOURCE_OF_TRUTH_USER_ID
Default admin:            $DEFAULT_USER_ID_VALUE
Auto admin users:         $AUTO_ADMIN_USER_IDS_VALUE
Admin email:              $ADMIN_EMAIL
Admin department:         $ADMIN_DEPARTMENT
Buganizer URL:            ${BUGANIZER_URL:-<not configured>}
Runtime logs:             ${RUNTIME_LOG_DIR:-<terminal only>}
Runtime report:           ${RUNTIME_REPORT_FILE:-<not requested>}
EOF_SUMMARY
}

if [[ "$PRINT_RUNTIME_CONFIG" == "true" && -f "$ROOT_DIR/scripts/workstation-up.sh" && "${SYSGRID_SKIP_WORKSTATION_SELF_TEST:-0}" != "1" ]]; then
  /bin/bash -n "$ROOT_DIR/scripts/workstation-up.sh"
  SYSGRID_SKIP_WORKSTATION_SELF_TEST=1 /bin/bash "$ROOT_DIR/scripts/workstation-up.sh" --self-test
fi

print_runtime_summary
if [[ "$PRINT_RUNTIME_CONFIG" == "true" ]]; then
  exit 0
fi

LOCAL_CONFIG_DB="$BACKEND_DIR/config.local.db"
LOCAL_TENANT_ROOT="$BACKEND_DIR/tenants/local-demo"
LOCAL_TENANT_DB_REL="tenants/local-demo/local_demo.db"
LOCAL_TENANT_DB="$BACKEND_DIR/$LOCAL_TENANT_DB_REL"
sysgrid_require_free_port "$BACKEND_PORT"
sysgrid_require_free_port "$FRONTEND_PORT"
LOCAL_DATA_ACTION="$(sysgrid_local_data_action "$DATA_MODE" "$LOCAL_CONFIG_DB" "$LOCAL_TENANT_DB" "$LOCAL_TENANT_ROOT")"
LOCAL_BACKEND_ENV_FILE="$BACKEND_DIR/.env.local.runtime"
BACKEND_ENV_BACKUP_FILE="$(mktemp -t sysgrid-backend-env)"
BACKEND_ENV_EXISTED="false"
BACKEND_ENV_RESTORED="false"
if [[ -e "$LOCAL_BACKEND_ENV_FILE" ]]; then
  cp -p "$LOCAL_BACKEND_ENV_FILE" "$BACKEND_ENV_BACKUP_FILE"
  BACKEND_ENV_EXISTED="true"
fi

export CONFIG_DATABASE_URL="sqlite+aiosqlite:///$LOCAL_CONFIG_DB"
export DATABASE_URL="sqlite+aiosqlite:///$LOCAL_TENANT_DB"
export TENANT_STORAGE_ROOT="$LOCAL_TENANT_ROOT"
export FRONTEND_ENV_FILE_PATH="$FRONTEND_DIR/.env.local"
export BACKEND_ENV_FILE_PATH="$LOCAL_BACKEND_ENV_FILE"
export DEFAULT_TENANT_NAME="Local Demo"
export PUBLIC_READONLY_ENABLED="true"
export PUBLIC_READONLY_TENANT_NAME="Local Demo"
export DEFAULT_USER_ID="$DEFAULT_USER_ID_VALUE"
export AUTO_ADMIN_USER_IDS="$AUTO_ADMIN_USER_IDS_VALUE"
export USER_ID_ENV_VAR="$USER_ID_ENV_VAR_VALUE"
export "$USER_ID_ENV_VAR_VALUE=$SOURCE_OF_TRUTH_USER_ID"
export USER_ID="$SOURCE_OF_TRUTH_USER_ID"
export DEFAULT_EMAIL_DOMAIN="sysgrid.local"
export ENVIRONMENT="development"

restore_backend_runtime_env() {
  if [[ "$BACKEND_ENV_RESTORED" == "true" ]]; then
    return 0
  fi
  if [[ "$BACKEND_ENV_EXISTED" == "true" ]]; then
    if ! cp -p "$BACKEND_ENV_BACKUP_FILE" "$LOCAL_BACKEND_ENV_FILE"; then
      echo "WARNING: failed to restore $LOCAL_BACKEND_ENV_FILE" >&2
      return 1
    fi
  else
    rm -f "$LOCAL_BACKEND_ENV_FILE"
  fi
  rm -f "$BACKEND_ENV_BACKUP_FILE"
  BACKEND_ENV_RESTORED="true"
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then kill "$BACKEND_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then kill "$FRONTEND_PID" >/dev/null 2>&1 || true; fi
  restore_backend_runtime_env || true
}
trap cleanup EXIT INT TERM

require_file() {
  local path="$1"
  local message="$2"
  if [[ ! -e "$path" ]]; then
    echo "Missing required file: $path" >&2
    echo "$message" >&2
    exit 1
  fi
}

print_probe_failure() {
  local title="$1"
  local status_code="$2"
  local body="$3"
  cat >&2 <<EOF_FAILURE

BACKEND PREFLIGHT FAILED: $title
----------------------------------------
Local probe:          $LOCAL_HEALTH_URL
Browser API origin:   $API_BASE_URL
Host header tested:   $API_PUBLIC_HOSTNAME
Frontend origin:      $FRONTEND_ORIGIN
HTTP status:          $status_code
Response body:        ${body:-<empty>}

Resolved ALLOWED_HOSTS:
$ALLOWED_HOSTS

Resolved BACKEND_CORS_ORIGINS:
$BACKEND_CORS_ORIGINS
EOF_FAILURE
}

wait_for_backend_contract() {
  local body_file header_file status_code body_text request_id allow_origin
  body_file="$(mktemp -t sysgrid-health-body)"
  header_file="$(mktemp -t sysgrid-health-headers)"
  trap 'rm -f "$body_file" "$header_file"; cleanup' EXIT INT TERM

  for _ in $(seq 1 60); do
    status_code="$(
      curl -sS \
        -D "$header_file" \
        -o "$body_file" \
        -w '%{http_code}' \
        -H "Host: $API_PUBLIC_HOSTNAME" \
        -H "Origin: $FRONTEND_ORIGIN" \
        "$LOCAL_HEALTH_URL" 2>/dev/null || true
    )"
    if [[ "$status_code" == "200" ]]; then
      body_text="$(tr '\n' ' ' < "$body_file" | cut -c1-500)"
      request_id="$(awk 'BEGIN{IGNORECASE=1} /^x-request-id:/ {sub(/\r$/,"",$2); print $2; exit}' "$header_file")"
      allow_origin="$(awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {sub(/\r$/,"",$2); print $2; exit}' "$header_file")"
      if [[ "$allow_origin" != "$FRONTEND_ORIGIN" && "$allow_origin" != "*" ]]; then
        print_probe_failure "CORS origin was not accepted" "$status_code" "$body_text"
        echo "Expected Access-Control-Allow-Origin: $FRONTEND_ORIGIN" >&2
        echo "Observed Access-Control-Allow-Origin: ${allow_origin:-<missing>}" >&2
        exit 1
      fi
      echo "Backend host/CORS preflight passed."
      echo "  HTTP status: 200"
      echo "  Request ID: ${request_id:-<not returned>}"
      echo "  Access-Control-Allow-Origin: ${allow_origin:-<missing>}"
      rm -f "$body_file" "$header_file"
      trap cleanup EXIT INT TERM
      return 0
    fi

    body_text="$(tr '\n' ' ' < "$body_file" 2>/dev/null | cut -c1-500)"
    if [[ "$status_code" == "400" && "$body_text" == *"Invalid host header"* ]]; then
      print_probe_failure "trusted-host rejection" "$status_code" "$body_text"
      echo "Root cause: $API_PUBLIC_HOSTNAME is not accepted by TrustedHostMiddleware." >&2
      echo "The startup script attempted to configure it automatically; inspect backend/.env.local.runtime for drift." >&2
      exit 1
    fi
    sleep 1
  done

  body_text="$(tr '\n' ' ' < "$body_file" 2>/dev/null | cut -c1-500)"
  print_probe_failure "backend did not become healthy" "${status_code:-000}" "$body_text"
  exit 1
}

wait_for_frontend() {
  local status_code="000"
  for _ in $(seq 1 60); do
    status_code="$(curl -sS -o /dev/null -w '%{http_code}' "$LOCAL_FRONTEND_URL" 2>/dev/null || true)"
    if [[ "$status_code" == "200" ]]; then
      echo "Frontend local readiness: PASS ($LOCAL_FRONTEND_URL)"
      return 0
    fi
    sleep 1
  done
  echo "Frontend did not become ready at $LOCAL_FRONTEND_URL (last status $status_code)." >&2
  exit 1
}

probe_public_frontend() {
  [[ "$PUBLIC_FRONTEND_PROBE" == "true" ]] || return 0
  local header_file body_file status_code content_type location
  header_file="$(mktemp -t sysgrid-public-frontend-headers)"
  body_file="$(mktemp -t sysgrid-public-frontend-body)"
  status_code="$(curl -sS --max-time 12 -D "$header_file" -o "$body_file" -w '%{http_code}' "$FRONTEND_ORIGIN" 2>/dev/null || true)"
  content_type="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/ {sub(/\r$/,"",$0); sub(/^[^:]+:[[:space:]]*/,"",$0); print; exit}' "$header_file")"
  location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/\r$/,"",$0); sub(/^[^:]+:[[:space:]]*/,"",$0); print; exit}' "$header_file")"
  rm -f "$header_file" "$body_file"

  if [[ "$status_code" == "200" && "$content_type" == *"text/html"* ]]; then
    echo "Browser-visible frontend probe: PASS ($FRONTEND_ORIGIN)"
    return 0
  fi

  if [[ "$status_code" =~ ^30[12378]$ ]]; then
    echo "Browser-visible frontend probe requires proxy/authentication completion (HTTP $status_code${location:+ -> $location})."
  else
    echo "WARNING: browser-visible frontend probe did not return application HTML (HTTP ${status_code:-000}, content-type ${content_type:-<missing>})." >&2
  fi

  if [[ "$REQUIRE_PUBLIC_FRONTEND" == "true" ]]; then
    echo "Strict public frontend proof was requested; refusing to continue." >&2
    exit 1
  fi
}

write_runtime_report() {
  [[ -n "$RUNTIME_REPORT_FILE" ]] || return 0
  local git_head git_origin_main
  git_head="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  git_origin_main="$(git -C "$ROOT_DIR" rev-parse origin/main 2>/dev/null || true)"
  SYSGRID_REPORT_PROFILE="$PROFILE_NAME" \
  SYSGRID_REPORT_DATA_MODE="$DATA_MODE" \
  SYSGRID_REPORT_SEED_DOMAIN_DATA="$SEED_DOMAIN_DATA" \
  SYSGRID_REPORT_ROOT_DIR="$ROOT_DIR" \
  SYSGRID_REPORT_GIT_HEAD="$git_head" \
  SYSGRID_REPORT_GIT_ORIGIN_MAIN="$git_origin_main" \
  SYSGRID_REPORT_FRONTEND_ORIGIN="$FRONTEND_ORIGIN" \
  SYSGRID_REPORT_API_BASE_URL="$API_BASE_URL" \
  SYSGRID_REPORT_PUBLIC_HEALTH_URL="$PUBLIC_HEALTH_URL" \
  SYSGRID_REPORT_LOCAL_FRONTEND_URL="$LOCAL_FRONTEND_URL" \
  SYSGRID_REPORT_LOCAL_HEALTH_URL="$LOCAL_HEALTH_URL" \
  SYSGRID_REPORT_API_PUBLIC_HOSTNAME="$API_PUBLIC_HOSTNAME" \
  SYSGRID_REPORT_ALLOWED_HOSTS="$ALLOWED_HOSTS" \
  SYSGRID_REPORT_CORS_ORIGINS="$BACKEND_CORS_ORIGINS" \
  SYSGRID_REPORT_IDENTITY_VARIABLE="$USER_ID_ENV_VAR_VALUE" \
  SYSGRID_REPORT_EFFECTIVE_USER="$SOURCE_OF_TRUTH_USER_ID" \
  SYSGRID_REPORT_DEFAULT_ADMIN="$DEFAULT_USER_ID_VALUE" \
  SYSGRID_REPORT_BUGANIZER_URL="$BUGANIZER_URL" \
  SYSGRID_REPORT_BACKEND_PID="$BACKEND_PID" \
  SYSGRID_REPORT_FRONTEND_PID="$FRONTEND_PID" \
  SYSGRID_REPORT_LOG_DIR="$RUNTIME_LOG_DIR" \
  SYSGRID_REPORT_TENANT_DB="$LOCAL_TENANT_DB" \
  SYSGRID_REPORT_CONFIG_DB="$LOCAL_CONFIG_DB" \
  "$PYTHON_BIN" - "$RUNTIME_REPORT_FILE" <<'PY_REPORT'
import datetime as dt
import json
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = {
    "schema_version": "1.0.0",
    "classification": "SYSGRID_UAT_RUNTIME_REPORT",
    "created_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "profile": os.environ["SYSGRID_REPORT_PROFILE"],
    "data_mode": os.environ["SYSGRID_REPORT_DATA_MODE"],
    "seed_domain_data": os.environ["SYSGRID_REPORT_SEED_DOMAIN_DATA"] == "true",
    "repository": os.environ["SYSGRID_REPORT_ROOT_DIR"],
    "git_head": os.environ["SYSGRID_REPORT_GIT_HEAD"],
    "git_origin_main": os.environ["SYSGRID_REPORT_GIT_ORIGIN_MAIN"],
    "frontend_origin": os.environ["SYSGRID_REPORT_FRONTEND_ORIGIN"],
    "api_base_url": os.environ["SYSGRID_REPORT_API_BASE_URL"],
    "public_health_url": os.environ["SYSGRID_REPORT_PUBLIC_HEALTH_URL"],
    "local_frontend_url": os.environ["SYSGRID_REPORT_LOCAL_FRONTEND_URL"],
    "local_health_url": os.environ["SYSGRID_REPORT_LOCAL_HEALTH_URL"],
    "trusted_api_hostname": os.environ["SYSGRID_REPORT_API_PUBLIC_HOSTNAME"],
    "allowed_hosts": os.environ["SYSGRID_REPORT_ALLOWED_HOSTS"],
    "cors_origins": os.environ["SYSGRID_REPORT_CORS_ORIGINS"],
    "identity_variable": os.environ["SYSGRID_REPORT_IDENTITY_VARIABLE"],
    "effective_user": os.environ["SYSGRID_REPORT_EFFECTIVE_USER"],
    "default_admin": os.environ["SYSGRID_REPORT_DEFAULT_ADMIN"],
    "buganizer_url": os.environ["SYSGRID_REPORT_BUGANIZER_URL"],
    "backend_pid": int(os.environ["SYSGRID_REPORT_BACKEND_PID"]),
    "frontend_pid": int(os.environ["SYSGRID_REPORT_FRONTEND_PID"]),
    "runtime_log_dir": os.environ["SYSGRID_REPORT_LOG_DIR"],
    "tenant_db": os.environ["SYSGRID_REPORT_TENANT_DB"],
    "config_db": os.environ["SYSGRID_REPORT_CONFIG_DB"],
}
path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
PY_REPORT
  echo "Runtime evidence report: $RUNTIME_REPORT_FILE"
}

echo "Preparing SysGrid development/UAT environment..."

if [[ "$RUN_TYPECHECK" == "true" ]]; then
  echo "Running frontend typecheck..."
  TYPECHECK_LOG="${RUNTIME_LOG_DIR:+$RUNTIME_LOG_DIR/typecheck.log}"
  [[ -n "$TYPECHECK_LOG" ]] || TYPECHECK_LOG="$(mktemp -t sysgrid-typecheck)"
  if (
    cd "$FRONTEND_DIR"
    npx tsc --noEmit
  ) >"$TYPECHECK_LOG" 2>&1; then
    echo "Frontend typecheck passed."
  else
    echo "Frontend typecheck reported errors."
    echo "Log: $TYPECHECK_LOG"
    sed -n '1,60p' "$TYPECHECK_LOG"
    if [[ "$STRICT_STARTUP_CHECKS" == "true" ]]; then
      echo "Strict startup checks enabled. Refusing to start until typecheck passes."
      exit 1
    fi
    echo "Continuing startup because strict checks were not requested. Use ./scripts/verify-app.sh for full qualification."
  fi
else
  echo "Skipping frontend typecheck."
fi

echo "Cleaning frontend build artifacts..."
rm -rf "$FRONTEND_DIR/dist" "$FRONTEND_DIR/.vite" "$FRONTEND_DIR/node_modules/.cache"

require_file "$BACKEND_DIR/venv/bin/python" "Create the backend venv first: cd backend && python3 -m venv venv && venv/bin/pip install -r requirements.txt"
require_file "$FRONTEND_DIR/node_modules" "Install frontend dependencies first: cd frontend && npm install"

mkdir -p "$BACKEND_DIR/tenants"
if [[ "$LOCAL_DATA_ACTION" == "reset" ]]; then
  sysgrid_archive_local_data "$LOCAL_CONFIG_DB" "$LOCAL_TENANT_ROOT" "$BACKEND_DIR/local-data-archives"
  mkdir -p "$LOCAL_TENANT_ROOT"
elif [[ "$LOCAL_DATA_ACTION" == "preserve" ]]; then
  echo "Preserving existing Local Demo databases."
fi

cat > "$LOCAL_BACKEND_ENV_FILE" <<EOF_BACKEND
ALLOWED_HOSTS=$ALLOWED_HOSTS
BACKEND_CORS_ORIGINS=$BACKEND_CORS_ORIGINS
CONFIG_DATABASE_URL=$CONFIG_DATABASE_URL
DATABASE_URL=$DATABASE_URL
TENANT_STORAGE_ROOT=$TENANT_STORAGE_ROOT
FRONTEND_ENV_FILE_PATH=$FRONTEND_ENV_FILE_PATH
BACKEND_ENV_FILE_PATH=$BACKEND_ENV_FILE_PATH
DEFAULT_TENANT_NAME=$DEFAULT_TENANT_NAME
PUBLIC_READONLY_ENABLED=$PUBLIC_READONLY_ENABLED
PUBLIC_READONLY_TENANT_NAME=$PUBLIC_READONLY_TENANT_NAME
DEFAULT_USER_ID=$DEFAULT_USER_ID
AUTO_ADMIN_USER_IDS=$AUTO_ADMIN_USER_IDS
USER_ID_ENV_VAR=$USER_ID_ENV_VAR
SOURCE_OF_TRUTH_USER_ID=$SOURCE_OF_TRUTH_USER_ID
${USER_ID_ENV_VAR_VALUE}=$SOURCE_OF_TRUTH_USER_ID
DEFAULT_EMAIL_DOMAIN=$DEFAULT_EMAIL_DOMAIN
PORT=$BACKEND_PORT
EOF_BACKEND

cat > "$FRONTEND_DIR/.env.local" <<EOF_FRONTEND
VITE_API_BASE_URL=$API_BASE_URL
VITE_FRONTEND_ORIGIN=$FRONTEND_ORIGIN
VITE_PORT=$FRONTEND_PORT
VITE_BACKEND_PORT=$BACKEND_PORT
VITE_BACKEND_HOST=$BACKEND_HOST
VITE_BUGANIZER_URL=$BUGANIZER_URL
EOF_FRONTEND

if [[ "$LOCAL_DATA_ACTION" != "preserve" ]]; then
  echo "Initializing Local Demo tenant..."
  seed_args=(
    --tenant-name "Local Demo"
    --tenant-db "$LOCAL_TENANT_DB_REL"
    --admin-user "$DEFAULT_USER_ID_VALUE"
    --admin-full-name "$ADMIN_FULL_NAME"
    --admin-email "$ADMIN_EMAIL"
    --admin-department "$ADMIN_DEPARTMENT"
  )
  if [[ "$SEED_DOMAIN_DATA" == "true" ]]; then
    seed_args+=(--seed-data)
  else
    seed_args+=(--no-seed-data)
  fi
  IFS=',' read -r -a configured_admin_ids <<< "$AUTO_ADMIN_USER_IDS_VALUE"
  for configured_admin_id in "${configured_admin_ids[@]}"; do
    configured_admin_id="${configured_admin_id#"${configured_admin_id%%[![:space:]]*}"}"
    configured_admin_id="${configured_admin_id%"${configured_admin_id##*[![:space:]]}"}"
    [[ -n "$configured_admin_id" && "$configured_admin_id" != "$DEFAULT_USER_ID_VALUE" ]] || continue
    seed_args+=(--extra-admin-user "$configured_admin_id")
  done
  (cd "$ROOT_DIR" && ./backend/venv/bin/python seed.py "${seed_args[@]}")
else
  echo "Skipping seed because existing UAT data is being resumed."
fi

echo "Provisioning code-managed reference data..."
(
  cd "$BACKEND_DIR"
  ./venv/bin/python -m app.reference_data
)

echo "Running preflight..."
"$ROOT_DIR/scripts/preflight.py"

BACKEND_LOG="${RUNTIME_LOG_DIR:+$RUNTIME_LOG_DIR/backend.log}"
FRONTEND_LOG="${RUNTIME_LOG_DIR:+$RUNTIME_LOG_DIR/frontend.log}"

echo "Starting backend on http://$BACKEND_HOST:$BACKEND_PORT"
if [[ -n "$BACKEND_LOG" ]]; then
  : > "$BACKEND_LOG"
  (
    cd "$BACKEND_DIR"
    PYTHONPATH=. "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
  ) > >(tee -a "$BACKEND_LOG") 2>&1 &
else
  (
    cd "$BACKEND_DIR"
    PYTHONPATH=. "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
  ) &
fi
BACKEND_PID=$!

echo "Waiting for backend host/CORS/health contract..."
wait_for_backend_contract

echo "Starting frontend on http://$FRONTEND_HOST:$FRONTEND_PORT"
if [[ -n "$FRONTEND_LOG" ]]; then
  : > "$FRONTEND_LOG"
  (
    cd "$FRONTEND_DIR"
    npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  ) > >(tee -a "$FRONTEND_LOG") 2>&1 &
else
  (
    cd "$FRONTEND_DIR"
    npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  ) &
fi
FRONTEND_PID=$!

wait_for_frontend
probe_public_frontend
write_runtime_report

cat <<EOF_READY

SYSGRID DEVELOPMENT/UAT RUNTIME READY
-------------------------------------
Profile:            $PROFILE_NAME
Data mode:          $DATA_MODE
Frontend (browser): $FRONTEND_ORIGIN
Frontend (local):   $LOCAL_FRONTEND_URL
Backend health:     $PUBLIC_HEALTH_URL
Backend local:      $LOCAL_HEALTH_URL
API base:           $API_BASE_URL
Trusted host:       $API_PUBLIC_HOSTNAME
Bootstrap user:     $SOURCE_OF_TRUTH_USER_ID
Seed domain data:   $SEED_DOMAIN_DATA
Backend runtime:    $LOCAL_BACKEND_ENV_FILE
Tenant DB:          $LOCAL_TENANT_DB
Config DB:          $LOCAL_CONFIG_DB
Runtime logs:       ${RUNTIME_LOG_DIR:-<terminal only>}
Runtime report:     ${RUNTIME_REPORT_FILE:-<not requested>}

This is a production-like development/UAT runtime using Local Demo SQLite data.
It does not use or modify production tenant/configuration databases.

Troubleshooting:
  1. Open $PUBLIC_HEALTH_URL.
  2. Open $FRONTEND_ORIGIN.
  3. Run workstation diagnostics from another Terminal when available.
  4. Clear stale browser API overrides from the bootstrap failure window.
  5. Use Copy Diagnostics / Open Buganizer for product feedback.
EOF_READY

wait
