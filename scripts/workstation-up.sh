#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ORIGINAL_ARGS=("$@")

COMMAND="start"
case "${1:-}" in
  start|configure|validate|doctor|diagnostics|reset)
    COMMAND="$1"
    shift
    ;;
esac

PROFILE_NAME="work"
CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/sysgrid/workstations"
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/sysgrid-workstation"

API_BASE_URL_ARG=""
FRONTEND_ORIGIN_ARG=""
BACKEND_HOST_ARG=""
BACKEND_PORT_ARG=""
FRONTEND_HOST_ARG=""
FRONTEND_PORT_ARG=""
USER_ID_ENV_VAR_ARG=""
RUNTIME_EFFECTIVE_USER_ID_ARG=""
DEFAULT_USER_ID_ARG=""
AUTO_ADMIN_USER_IDS_ARG=""
ADMIN_FULL_NAME_ARG=""
ADMIN_EMAIL_ARG=""
ADMIN_DEPARTMENT_ARG=""
BUGANIZER_URL_ARG=""
DATA_MODE_ARG=""
PUBLIC_FRONTEND_POLICY_ARG=""
SYNC_MAIN_ARG=""
INSTALL_DEPENDENCIES_ARG=""
STRICT_CHECKS_ARG=""
FORCE_CONFIGURE="false"
PRINT_CONFIG_ONLY="false"
SELF_TEST="false"
YES="false"
SKIP_DNS_CHECK="false"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/workstation-up.sh [command] [options]

Commands:
  start         Synchronize, configure, provision, seed/resume, validate, and start (default)
  configure     Guided creation or update of a named workstation profile
  validate      Validate the profile, dependencies, runtime-origin contract, and scripts
  doctor        Read-only workstation/repository/DNS/port/runtime health report
  diagnostics   Create a sanitized UAT evidence ZIP for acceptance feedback
  reset         Start with a fresh seed (defaults to fresh-full)

Core options:
  --profile <name>                    Named profile (default: work)
  --configure                         Run guided profile configuration before command
  --api-base-url <origin>             Browser-visible backend origin
  --frontend-origin <origin>          Browser-visible frontend origin
  --backend-host <host>               Local backend bind host (default 127.0.0.1)
  --backend-port <port>               Local backend port (default 8000)
  --frontend-host <host>              Local Vite bind host (default 127.0.0.1)
  --frontend-port <port>              Local Vite port (default 5173)
  --user-id-env-var <name>            Work identity variable (default AccessKey)
  --runtime-effective-user-id <id>    Effective UAT identity
  --default-user-id <id>              Primary seeded admin username
  --auto-admin-user-ids <csv>         Additional automatic admin identities
  --admin-full-name <name>
  --admin-email <email>
  --admin-department <department>
  --buganizer-url <url>

UAT data modes:
  --data-mode fresh-full              Backup current Local Demo data, reset, seed full data
  --data-mode fresh-foundation        Backup current Local Demo data, reset, seed foundation only
  --data-mode resume                  Preserve and continue the current Local Demo data

Workflow controls:
  --skip-sync                         Do not fetch/reset origin/main for this invocation
  --sync                              Force repository synchronization
  --skip-dependency-install           Require existing current dependencies
  --install-dependencies              Force dependency reconciliation
  --strict-checks                     Refuse startup on typecheck failure
  --no-strict-checks                  Allow development startup after typecheck warning
  --public-frontend-policy <mode>     warn (default), require, or skip
  --skip-dns-check                    Diagnostic override only
  --print-config                      Resolve and print profile without starting
  --yes                               Accept safe defaults where a confirmation is offered
  --self-test                         Run deterministic launcher tests
  --help

First run:
  bash scripts/workstation-up.sh configure --profile work
  bash scripts/workstation-up.sh start --profile work

Normal repeat launch:
  bash scripts/workstation-up.sh

Acceptance feedback evidence (from a second Terminal):
  bash scripts/workstation-up.sh diagnostics
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_NAME="$2"; shift 2 ;;
    --configure|--reconfigure) FORCE_CONFIGURE="true"; shift ;;
    --api-base-url) API_BASE_URL_ARG="$2"; shift 2 ;;
    --frontend-origin) FRONTEND_ORIGIN_ARG="$2"; shift 2 ;;
    --backend-host) BACKEND_HOST_ARG="$2"; shift 2 ;;
    --backend-port) BACKEND_PORT_ARG="$2"; shift 2 ;;
    --frontend-host) FRONTEND_HOST_ARG="$2"; shift 2 ;;
    --frontend-port) FRONTEND_PORT_ARG="$2"; shift 2 ;;
    --user-id-env-var) USER_ID_ENV_VAR_ARG="$2"; shift 2 ;;
    --runtime-effective-user-id) RUNTIME_EFFECTIVE_USER_ID_ARG="$2"; shift 2 ;;
    --default-user-id) DEFAULT_USER_ID_ARG="$2"; shift 2 ;;
    --auto-admin-user-ids) AUTO_ADMIN_USER_IDS_ARG="$2"; shift 2 ;;
    --admin-full-name) ADMIN_FULL_NAME_ARG="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL_ARG="$2"; shift 2 ;;
    --admin-department) ADMIN_DEPARTMENT_ARG="$2"; shift 2 ;;
    --buganizer-url) BUGANIZER_URL_ARG="$2"; shift 2 ;;
    --data-mode) DATA_MODE_ARG="$2"; shift 2 ;;
    --public-frontend-policy) PUBLIC_FRONTEND_POLICY_ARG="$2"; shift 2 ;;
    --skip-sync) SYNC_MAIN_ARG="false"; shift ;;
    --sync) SYNC_MAIN_ARG="true"; shift ;;
    --skip-dependency-install) INSTALL_DEPENDENCIES_ARG="false"; shift ;;
    --install-dependencies) INSTALL_DEPENDENCIES_ARG="true"; shift ;;
    --strict-checks) STRICT_CHECKS_ARG="true"; shift ;;
    --no-strict-checks) STRICT_CHECKS_ARG="false"; shift ;;
    --skip-dns-check) SKIP_DNS_CHECK="true"; shift ;;
    --print-config) PRINT_CONFIG_ONLY="true"; shift ;;
    --yes|-y) YES="true"; shift ;;
    --self-test) SELF_TEST="true"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$PROFILE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  echo "Invalid profile name: $PROFILE_NAME" >&2
  exit 1
}

PROFILE_DIR="$STATE_ROOT/profiles/$PROFILE_NAME"
PROFILE_FILE="$CONFIG_ROOT/$PROFILE_NAME.env"
BACKUP_ROOT="$PROFILE_DIR/repository-backups"
DATA_BACKUP_ROOT="$PROFILE_DIR/data-backups"
RUNS_ROOT="$PROFILE_DIR/runs"
DIAGNOSTICS_ROOT="$PROFILE_DIR/diagnostics"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    return 1
  }
}

sha256_file() {
  python3 - "$1" <<'PY'
import hashlib
import pathlib
import sys
p = pathlib.Path(sys.argv[1])
h = hashlib.sha256()
with p.open("rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        h.update(chunk)
print(h.hexdigest())
PY
}

normalize_origin() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit
raw = sys.argv[1].strip()
parts = urlsplit(raw)
if parts.scheme not in {"http", "https"}:
    raise SystemExit("origin must use http or https")
if not parts.hostname or not parts.netloc:
    raise SystemExit("origin must include a hostname")
if parts.username or parts.password:
    raise SystemExit("origin must not contain credentials")
if parts.path not in {"", "/"} or parts.query or parts.fragment:
    raise SystemExit("origin must not contain a path, query, or fragment")
port = f":{parts.port}" if parts.port else ""
host = parts.hostname
if ":" in host and not host.startswith("["):
    host = f"[{host}]"
print(f"{parts.scheme}://{host}{port}")
PY
}

origin_hostname() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit
print(urlsplit(sys.argv[1]).hostname or "")
PY
}

origin_scheme() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit
print(urlsplit(sys.argv[1]).scheme)
PY
}

proxy_origin() {
  local template="$1" port="$2"
  if [[ "$template" == *"{{port}}"* ]]; then
    printf '%s\n' "${template//\{\{port\}\}/$port}"
    return 0
  fi
  return 1
}

validate_bool() {
  case "$1" in true|false) ;; *) echo "Expected true or false, received: $1" >&2; return 1 ;; esac
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 )) || {
    echo "Invalid port: $1" >&2
    return 1
  }
}

validate_data_mode() {
  case "$1" in fresh-full|fresh-foundation|resume) ;; *) echo "Invalid UAT data mode: $1" >&2; return 1 ;; esac
}

validate_public_policy() {
  case "$1" in warn|require|skip) ;; *) echo "Invalid public frontend policy: $1" >&2; return 1 ;; esac
}

prompt_value() {
  local label="$1" default_value="$2" result
  [[ -t 0 ]] || {
    echo "Interactive configuration is required for: $label" >&2
    echo "Run in a Terminal or pass the corresponding CLI option/environment variable." >&2
    exit 1
  }
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " result
    printf '%s\n' "${result:-$default_value}"
  else
    read -r -p "$label: " result
    printf '%s\n' "$result"
  fi
}

prompt_yes_no() {
  local label="$1" default_value="$2" answer suffix
  if [[ "$YES" == "true" ]]; then
    printf '%s\n' "$default_value"
    return 0
  fi
  suffix="[y/N]"
  [[ "$default_value" == "true" ]] && suffix="[Y/n]"
  read -r -p "$label $suffix: " answer
  case "$answer" in
    y|Y|yes|YES) printf 'true\n' ;;
    n|N|no|NO) printf 'false\n' ;;
    "") printf '%s\n' "$default_value" ;;
    *) echo "Please answer yes or no." >&2; prompt_yes_no "$label" "$default_value" ;;
  esac
}

prompt_choice() {
  local label="$1" default_value="$2" choices="$3" answer
  while true; do
    read -r -p "$label [$default_value] ($choices): " answer
    answer="${answer:-$default_value}"
    case " $choices " in
      *" $answer "*) printf '%s\n' "$answer"; return 0 ;;
    esac
    echo "Choose one of: $choices" >&2
  done
}

load_profile() {
  SAVED_API_BASE_URL=""
  SAVED_FRONTEND_ORIGIN=""
  SAVED_BACKEND_HOST=""
  SAVED_BACKEND_PORT=""
  SAVED_FRONTEND_HOST=""
  SAVED_FRONTEND_PORT=""
  SAVED_USER_ID_ENV_VAR=""
  SAVED_RUNTIME_EFFECTIVE_USER_ID=""
  SAVED_DEFAULT_USER_ID=""
  SAVED_AUTO_ADMIN_USER_IDS=""
  SAVED_ADMIN_FULL_NAME=""
  SAVED_ADMIN_EMAIL=""
  SAVED_ADMIN_DEPARTMENT=""
  SAVED_BUGANIZER_URL=""
  SAVED_DEFAULT_DATA_MODE=""
  SAVED_PUBLIC_FRONTEND_POLICY=""
  SAVED_SYNC_MAIN=""
  SAVED_INSTALL_DEPENDENCIES=""
  SAVED_STRICT_CHECKS=""
  [[ -f "$PROFILE_FILE" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    case "$key" in
      API_BASE_URL) SAVED_API_BASE_URL="$value" ;;
      FRONTEND_ORIGIN) SAVED_FRONTEND_ORIGIN="$value" ;;
      BACKEND_HOST) SAVED_BACKEND_HOST="$value" ;;
      BACKEND_PORT) SAVED_BACKEND_PORT="$value" ;;
      FRONTEND_HOST) SAVED_FRONTEND_HOST="$value" ;;
      FRONTEND_PORT) SAVED_FRONTEND_PORT="$value" ;;
      USER_ID_ENV_VAR) SAVED_USER_ID_ENV_VAR="$value" ;;
      RUNTIME_EFFECTIVE_USER_ID) SAVED_RUNTIME_EFFECTIVE_USER_ID="$value" ;;
      DEFAULT_USER_ID) SAVED_DEFAULT_USER_ID="$value" ;;
      AUTO_ADMIN_USER_IDS) SAVED_AUTO_ADMIN_USER_IDS="$value" ;;
      ADMIN_FULL_NAME) SAVED_ADMIN_FULL_NAME="$value" ;;
      ADMIN_EMAIL) SAVED_ADMIN_EMAIL="$value" ;;
      ADMIN_DEPARTMENT) SAVED_ADMIN_DEPARTMENT="$value" ;;
      BUGANIZER_URL) SAVED_BUGANIZER_URL="$value" ;;
      DEFAULT_DATA_MODE) SAVED_DEFAULT_DATA_MODE="$value" ;;
      PUBLIC_FRONTEND_POLICY) SAVED_PUBLIC_FRONTEND_POLICY="$value" ;;
      SYNC_MAIN) SAVED_SYNC_MAIN="$value" ;;
      INSTALL_DEPENDENCIES) SAVED_INSTALL_DEPENDENCIES="$value" ;;
      STRICT_CHECKS) SAVED_STRICT_CHECKS="$value" ;;
    esac
  done < "$PROFILE_FILE"
}

save_profile() {
  mkdir -p "$CONFIG_ROOT"
  umask 077
  cat > "$PROFILE_FILE" <<EOF_PROFILE
# Non-secret SysGrid workstation/UAT profile.
API_BASE_URL=$API_BASE_URL
FRONTEND_ORIGIN=$FRONTEND_ORIGIN
BACKEND_HOST=$BACKEND_HOST
BACKEND_PORT=$BACKEND_PORT
FRONTEND_HOST=$FRONTEND_HOST
FRONTEND_PORT=$FRONTEND_PORT
USER_ID_ENV_VAR=$USER_ID_ENV_VAR
RUNTIME_EFFECTIVE_USER_ID=$RUNTIME_EFFECTIVE_USER_ID
DEFAULT_USER_ID=$DEFAULT_USER_ID
AUTO_ADMIN_USER_IDS=$AUTO_ADMIN_USER_IDS
ADMIN_FULL_NAME=$ADMIN_FULL_NAME
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_DEPARTMENT=$ADMIN_DEPARTMENT
BUGANIZER_URL=$BUGANIZER_URL
DEFAULT_DATA_MODE=$DEFAULT_DATA_MODE
PUBLIC_FRONTEND_POLICY=$PUBLIC_FRONTEND_POLICY
SYNC_MAIN=$SYNC_MAIN
INSTALL_DEPENDENCIES=$INSTALL_DEPENDENCIES
STRICT_CHECKS=$STRICT_CHECKS
EOF_PROFILE
  chmod 600 "$PROFILE_FILE"
}

detect_forwarded_origins() {
  DETECTED_API_BASE_URL=""
  DETECTED_FRONTEND_ORIGIN=""
  if [[ -n "${VSCODE_PROXY_URI:-}" ]]; then
    DETECTED_API_BASE_URL="$(proxy_origin "$VSCODE_PROXY_URI" "${BACKEND_PORT:-8000}" || true)"
    DETECTED_FRONTEND_ORIGIN="$(proxy_origin "$VSCODE_PROXY_URI" "${FRONTEND_PORT:-5173}" || true)"
  elif [[ -n "${SYSGRID_VSCODE_DOMAIN:-}" ]]; then
    DETECTED_API_BASE_URL="http://${BACKEND_PORT:-8000}.${SYSGRID_VSCODE_DOMAIN}"
    DETECTED_FRONTEND_ORIGIN="http://${FRONTEND_PORT:-5173}.${SYSGRID_VSCODE_DOMAIN}"
  fi
}

run_configuration_wizard() {
  echo
  echo "SYSGRID WORKSTATION/UAT PROFILE CONFIGURATION"
  echo "---------------------------------------------"
  echo "Profile: $PROFILE_NAME"
  echo "Values are stored privately at $PROFILE_FILE. No passwords or tokens are requested."
  echo

  BACKEND_HOST="$(prompt_value 'Local backend bind host' "${BACKEND_HOST:-127.0.0.1}")"
  BACKEND_PORT="$(prompt_value 'Local backend port' "${BACKEND_PORT:-8000}")"
  FRONTEND_HOST="$(prompt_value 'Local frontend bind host' "${FRONTEND_HOST:-127.0.0.1}")"
  FRONTEND_PORT="$(prompt_value 'Local frontend port' "${FRONTEND_PORT:-5173}")"
  validate_port "$BACKEND_PORT"
  validate_port "$FRONTEND_PORT"
  detect_forwarded_origins

  API_BASE_URL="$(prompt_value 'Browser-visible API origin' "${API_BASE_URL:-${DETECTED_API_BASE_URL:-http://8000.vscode.company.example}}")"
  FRONTEND_ORIGIN="$(prompt_value 'Browser-visible frontend origin' "${FRONTEND_ORIGIN:-${DETECTED_FRONTEND_ORIGIN:-http://5173.vscode.company.example}}")"
  USER_ID_ENV_VAR="$(prompt_value 'Work identity environment variable' "${USER_ID_ENV_VAR:-AccessKey}")"

  local detected_identity=""
  if [[ "$USER_ID_ENV_VAR" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    detected_identity="${!USER_ID_ENV_VAR:-}"
  fi
  RUNTIME_EFFECTIVE_USER_ID="$(prompt_value 'Effective UAT user identity' "${RUNTIME_EFFECTIVE_USER_ID:-${detected_identity:-haewon.kim}}")"
  DEFAULT_USER_ID="$(prompt_value 'Primary seeded admin username' "${DEFAULT_USER_ID:-$RUNTIME_EFFECTIVE_USER_ID}")"
  AUTO_ADMIN_USER_IDS="$(prompt_value 'Automatic admin identities (comma separated)' "${AUTO_ADMIN_USER_IDS:-$DEFAULT_USER_ID}")"
  ADMIN_FULL_NAME="$(prompt_value 'Primary admin full name' "${ADMIN_FULL_NAME:-Haewon Kim}")"
  ADMIN_EMAIL="$(prompt_value 'Primary admin email' "${ADMIN_EMAIL:-haewon.kim@sysgrid.local}")"
  ADMIN_DEPARTMENT="$(prompt_value 'Admin department' "${ADMIN_DEPARTMENT:-Infrastructure}")"
  BUGANIZER_URL="$(prompt_value 'Buganizer/new-issue URL (optional)' "${BUGANIZER_URL:-}")"
  DEFAULT_DATA_MODE="$(prompt_choice 'Default UAT data mode' "${DEFAULT_DATA_MODE:-fresh-full}" 'fresh-full fresh-foundation resume')"
  PUBLIC_FRONTEND_POLICY="$(prompt_choice 'Browser-visible frontend proof policy' "${PUBLIC_FRONTEND_POLICY:-warn}" 'warn require skip')"
  SYNC_MAIN="$(prompt_yes_no 'Synchronize and hard-reset to origin/main before each start?' "${SYNC_MAIN:-true}")"
  INSTALL_DEPENDENCIES="$(prompt_yes_no 'Automatically reconcile backend/frontend dependencies?' "${INSTALL_DEPENDENCIES:-true}")"
  STRICT_CHECKS="$(prompt_yes_no 'Require strict typecheck before startup?' "${STRICT_CHECKS:-true}")"

  validate_resolved_config
  save_profile
  echo "Profile saved: $PROFILE_FILE"
}

resolve_config() {
  load_profile

  BACKEND_HOST="${BACKEND_HOST_ARG:-${SYSGRID_BACKEND_HOST:-${SAVED_BACKEND_HOST:-127.0.0.1}}}"
  BACKEND_PORT="${BACKEND_PORT_ARG:-${SYSGRID_BACKEND_PORT:-${SAVED_BACKEND_PORT:-8000}}}"
  FRONTEND_HOST="${FRONTEND_HOST_ARG:-${SYSGRID_FRONTEND_HOST:-${SAVED_FRONTEND_HOST:-127.0.0.1}}}"
  FRONTEND_PORT="${FRONTEND_PORT_ARG:-${SYSGRID_FRONTEND_PORT:-${SAVED_FRONTEND_PORT:-5173}}}"
  validate_port "$BACKEND_PORT"
  validate_port "$FRONTEND_PORT"
  detect_forwarded_origins

  API_BASE_URL="${API_BASE_URL_ARG:-${SYSGRID_API_BASE_URL:-${SAVED_API_BASE_URL:-$DETECTED_API_BASE_URL}}}"
  FRONTEND_ORIGIN="${FRONTEND_ORIGIN_ARG:-${SYSGRID_FRONTEND_ORIGIN:-${SAVED_FRONTEND_ORIGIN:-$DETECTED_FRONTEND_ORIGIN}}}"
  USER_ID_ENV_VAR="${USER_ID_ENV_VAR_ARG:-${SYSGRID_USER_ID_ENV_VAR:-${SAVED_USER_ID_ENV_VAR:-AccessKey}}}"

  local detected_identity=""
  if [[ "$USER_ID_ENV_VAR" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    detected_identity="${!USER_ID_ENV_VAR:-}"
  fi
  RUNTIME_EFFECTIVE_USER_ID="${RUNTIME_EFFECTIVE_USER_ID_ARG:-${SYSGRID_RUNTIME_EFFECTIVE_USER_ID:-${SAVED_RUNTIME_EFFECTIVE_USER_ID:-$detected_identity}}}"
  DEFAULT_USER_ID="${DEFAULT_USER_ID_ARG:-${SYSGRID_DEFAULT_USER_ID:-${SAVED_DEFAULT_USER_ID:-${RUNTIME_EFFECTIVE_USER_ID:-haewon.kim}}}}"
  AUTO_ADMIN_USER_IDS="${AUTO_ADMIN_USER_IDS_ARG:-${SYSGRID_AUTO_ADMIN_USER_IDS:-${SAVED_AUTO_ADMIN_USER_IDS:-$DEFAULT_USER_ID}}}"
  ADMIN_FULL_NAME="${ADMIN_FULL_NAME_ARG:-${SYSGRID_ADMIN_FULL_NAME:-${SAVED_ADMIN_FULL_NAME:-Haewon Kim}}}"
  ADMIN_EMAIL="${ADMIN_EMAIL_ARG:-${SYSGRID_ADMIN_EMAIL:-${SAVED_ADMIN_EMAIL:-haewon.kim@sysgrid.local}}}"
  ADMIN_DEPARTMENT="${ADMIN_DEPARTMENT_ARG:-${SYSGRID_ADMIN_DEPARTMENT:-${SAVED_ADMIN_DEPARTMENT:-Infrastructure}}}"
  BUGANIZER_URL="${BUGANIZER_URL_ARG:-${SYSGRID_BUGANIZER_URL:-${SAVED_BUGANIZER_URL:-}}}"
  DEFAULT_DATA_MODE="${SAVED_DEFAULT_DATA_MODE:-fresh-full}"
  DATA_MODE="${DATA_MODE_ARG:-${SYSGRID_DATA_MODE:-$DEFAULT_DATA_MODE}}"
  PUBLIC_FRONTEND_POLICY="${PUBLIC_FRONTEND_POLICY_ARG:-${SYSGRID_PUBLIC_FRONTEND_POLICY:-${SAVED_PUBLIC_FRONTEND_POLICY:-warn}}}"
  SYNC_MAIN="${SYNC_MAIN_ARG:-${SYSGRID_SYNC_MAIN:-${SAVED_SYNC_MAIN:-true}}}"
  INSTALL_DEPENDENCIES="${INSTALL_DEPENDENCIES_ARG:-${SYSGRID_INSTALL_DEPENDENCIES:-${SAVED_INSTALL_DEPENDENCIES:-true}}}"
  STRICT_CHECKS="${STRICT_CHECKS_ARG:-${SYSGRID_STRICT_CHECKS:-${SAVED_STRICT_CHECKS:-true}}}"

  if [[ "$COMMAND" == "reset" && -z "$DATA_MODE_ARG" ]]; then
    DATA_MODE="fresh-full"
  fi

  if [[ "$FORCE_CONFIGURE" == "true" || "$COMMAND" == "configure" || -z "$API_BASE_URL" || -z "$FRONTEND_ORIGIN" || -z "$RUNTIME_EFFECTIVE_USER_ID" ]]; then
    run_configuration_wizard
    load_profile
    resolve_config_after_wizard
    return 0
  fi

  validate_resolved_config
}

resolve_config_after_wizard() {
  API_BASE_URL="${API_BASE_URL_ARG:-${SYSGRID_API_BASE_URL:-$SAVED_API_BASE_URL}}"
  FRONTEND_ORIGIN="${FRONTEND_ORIGIN_ARG:-${SYSGRID_FRONTEND_ORIGIN:-$SAVED_FRONTEND_ORIGIN}}"
  BACKEND_HOST="${BACKEND_HOST_ARG:-${SYSGRID_BACKEND_HOST:-$SAVED_BACKEND_HOST}}"
  BACKEND_PORT="${BACKEND_PORT_ARG:-${SYSGRID_BACKEND_PORT:-$SAVED_BACKEND_PORT}}"
  FRONTEND_HOST="${FRONTEND_HOST_ARG:-${SYSGRID_FRONTEND_HOST:-$SAVED_FRONTEND_HOST}}"
  FRONTEND_PORT="${FRONTEND_PORT_ARG:-${SYSGRID_FRONTEND_PORT:-$SAVED_FRONTEND_PORT}}"
  USER_ID_ENV_VAR="${USER_ID_ENV_VAR_ARG:-${SYSGRID_USER_ID_ENV_VAR:-$SAVED_USER_ID_ENV_VAR}}"
  RUNTIME_EFFECTIVE_USER_ID="${RUNTIME_EFFECTIVE_USER_ID_ARG:-${SYSGRID_RUNTIME_EFFECTIVE_USER_ID:-$SAVED_RUNTIME_EFFECTIVE_USER_ID}}"
  DEFAULT_USER_ID="${DEFAULT_USER_ID_ARG:-${SYSGRID_DEFAULT_USER_ID:-$SAVED_DEFAULT_USER_ID}}"
  AUTO_ADMIN_USER_IDS="${AUTO_ADMIN_USER_IDS_ARG:-${SYSGRID_AUTO_ADMIN_USER_IDS:-$SAVED_AUTO_ADMIN_USER_IDS}}"
  ADMIN_FULL_NAME="${ADMIN_FULL_NAME_ARG:-${SYSGRID_ADMIN_FULL_NAME:-$SAVED_ADMIN_FULL_NAME}}"
  ADMIN_EMAIL="${ADMIN_EMAIL_ARG:-${SYSGRID_ADMIN_EMAIL:-$SAVED_ADMIN_EMAIL}}"
  ADMIN_DEPARTMENT="${ADMIN_DEPARTMENT_ARG:-${SYSGRID_ADMIN_DEPARTMENT:-$SAVED_ADMIN_DEPARTMENT}}"
  BUGANIZER_URL="${BUGANIZER_URL_ARG:-${SYSGRID_BUGANIZER_URL:-$SAVED_BUGANIZER_URL}}"
  DEFAULT_DATA_MODE="$SAVED_DEFAULT_DATA_MODE"
  DATA_MODE="${DATA_MODE_ARG:-${SYSGRID_DATA_MODE:-$DEFAULT_DATA_MODE}}"
  PUBLIC_FRONTEND_POLICY="${PUBLIC_FRONTEND_POLICY_ARG:-${SYSGRID_PUBLIC_FRONTEND_POLICY:-$SAVED_PUBLIC_FRONTEND_POLICY}}"
  SYNC_MAIN="${SYNC_MAIN_ARG:-${SYSGRID_SYNC_MAIN:-$SAVED_SYNC_MAIN}}"
  INSTALL_DEPENDENCIES="${INSTALL_DEPENDENCIES_ARG:-${SYSGRID_INSTALL_DEPENDENCIES:-$SAVED_INSTALL_DEPENDENCIES}}"
  STRICT_CHECKS="${STRICT_CHECKS_ARG:-${SYSGRID_STRICT_CHECKS:-$SAVED_STRICT_CHECKS}}"
  [[ "$COMMAND" == "reset" && -z "$DATA_MODE_ARG" ]] && DATA_MODE="fresh-full"
  validate_resolved_config
}

validate_resolved_config() {
  API_BASE_URL="$(normalize_origin "$API_BASE_URL")"
  FRONTEND_ORIGIN="$(normalize_origin "$FRONTEND_ORIGIN")"
  validate_port "$BACKEND_PORT"
  validate_port "$FRONTEND_PORT"
  validate_data_mode "$DATA_MODE"
  validate_data_mode "$DEFAULT_DATA_MODE"
  validate_public_policy "$PUBLIC_FRONTEND_POLICY"
  validate_bool "$SYNC_MAIN"
  validate_bool "$INSTALL_DEPENDENCIES"
  validate_bool "$STRICT_CHECKS"

  [[ "$USER_ID_ENV_VAR" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "Invalid identity environment variable: $USER_ID_ENV_VAR" >&2
    exit 1
  }
  [[ -n "$RUNTIME_EFFECTIVE_USER_ID" ]] || { echo "Effective UAT identity is required." >&2; exit 1; }
  [[ -n "$DEFAULT_USER_ID" ]] || { echo "Default admin identity is required." >&2; exit 1; }

  if [[ "$(origin_scheme "$FRONTEND_ORIGIN")" == "https" && "$(origin_scheme "$API_BASE_URL")" != "https" ]]; then
    echo "Invalid mixed-content configuration: HTTPS frontend requires HTTPS API." >&2
    exit 1
  fi

  for value in "$API_BASE_URL" "$FRONTEND_ORIGIN" "$RUNTIME_EFFECTIVE_USER_ID" "$ADMIN_FULL_NAME" "$ADMIN_EMAIL" "$ADMIN_DEPARTMENT" "$BUGANIZER_URL"; do
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
      echo "Profile values may not contain newlines." >&2
      exit 1
    }
  done
}

print_config() {
  cat <<EOF_CONFIG

SYSGRID WORKSTATION/UAT PROFILE
-------------------------------
Profile:                     $PROFILE_NAME
Profile file:                $PROFILE_FILE
Repository:                  $ROOT_DIR
Browser API origin:          $API_BASE_URL
Browser frontend origin:     $FRONTEND_ORIGIN
Local backend bind:          $BACKEND_HOST:$BACKEND_PORT
Local frontend bind:         $FRONTEND_HOST:$FRONTEND_PORT
Identity variable:           $USER_ID_ENV_VAR
Effective UAT identity:      $RUNTIME_EFFECTIVE_USER_ID
Primary seeded admin:        $DEFAULT_USER_ID
Automatic admins:            $AUTO_ADMIN_USER_IDS
Admin full name:             $ADMIN_FULL_NAME
Admin email:                 $ADMIN_EMAIL
Admin department:            $ADMIN_DEPARTMENT
Buganizer URL:               ${BUGANIZER_URL:-<not configured>}
Selected data mode:          $DATA_MODE
Saved default data mode:     $DEFAULT_DATA_MODE
Public frontend proof:       $PUBLIC_FRONTEND_POLICY
Synchronize origin/main:     $SYNC_MAIN
Install changed dependencies: $INSTALL_DEPENDENCIES
Strict startup checks:       $STRICT_CHECKS
EOF_CONFIG
}

check_versions() {
  require_command git
  require_command python3
  require_command node
  require_command npm
  require_command curl
  require_command lsof

  python3 - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit(f"Python 3.11+ is required; found {sys.version.split()[0]}")
print(f"Python: {sys.version.split()[0]}")
PY
  node - <<'JS'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 13 || process.versions.node.includes('-')) {
  console.error(`Node.js 22 LTS (22.13.0 minimum) is required; found ${process.versions.node}`);
  process.exit(1);
}
console.log(`Node.js: ${process.versions.node}`);
JS
}

check_repository() {
  git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null
  git -C "$ROOT_DIR" remote get-url origin >/dev/null
  [[ -f "$ROOT_DIR/scripts/start-local.sh" ]] || { echo "Missing scripts/start-local.sh" >&2; exit 1; }
  [[ -f "$ROOT_DIR/seed.py" ]] || { echo "Missing seed.py" >&2; exit 1; }
}

backup_worktree() {
  local status timestamp backup_dir
  status="$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=all)"
  [[ -z "$status" ]] && return 0
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="$BACKUP_ROOT/$timestamp"
  mkdir -p "$backup_dir"
  printf '%s\n' "$status" > "$backup_dir/status.txt"
  git -C "$ROOT_DIR" diff --binary > "$backup_dir/working-tree.patch"
  git -C "$ROOT_DIR" diff --cached --binary > "$backup_dir/index.patch"
  git -C "$ROOT_DIR" bundle create "$backup_dir/repository.bundle" --all >/dev/null 2>&1 || true
  git -C "$ROOT_DIR" ls-files --others --exclude-standard -z > "$backup_dir/untracked.list"
  if [[ -s "$backup_dir/untracked.list" ]]; then
    python3 - "$ROOT_DIR" "$backup_dir/untracked.list" "$backup_dir/untracked.tar.gz" <<'PY'
import pathlib
import sys
import tarfile
root = pathlib.Path(sys.argv[1])
entries = pathlib.Path(sys.argv[2]).read_bytes().split(b"\0")
with tarfile.open(sys.argv[3], "w:gz") as archive:
    for raw in entries:
        if not raw:
            continue
        rel = pathlib.Path(raw.decode("utf-8", "surrogateescape"))
        path = root / rel
        if path.exists() or path.is_symlink():
            archive.add(path, arcname=str(rel), recursive=True)
PY
  fi
  echo "Local repository work backed up: $backup_dir"
}

sync_main() {
  check_repository
  local old_script_hash new_script_hash head origin_main
  old_script_hash="$(sha256_file "$ROOT_DIR/scripts/workstation-up.sh")"
  echo "Fetching authoritative origin/main..."
  git -C "$ROOT_DIR" fetch --prune origin main
  git -C "$ROOT_DIR" rev-parse --verify origin/main >/dev/null
  backup_worktree
  git -C "$ROOT_DIR" clean -fd
  git -C "$ROOT_DIR" checkout -B main origin/main
  git -C "$ROOT_DIR" reset --hard origin/main
  head="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  origin_main="$(git -C "$ROOT_DIR" rev-parse origin/main)"
  [[ "$head" == "$origin_main" ]] || { echo "Synchronization failed: HEAD != origin/main" >&2; exit 1; }
  echo "Repository synchronized: $head"

  new_script_hash="$(sha256_file "$ROOT_DIR/scripts/workstation-up.sh")"
  if [[ "$old_script_hash" != "$new_script_hash" && "${SYSGRID_WORKSTATION_REEXECUTED:-0}" != "1" ]]; then
    echo "A newer workstation launcher was fetched; restarting with the authoritative script."
    export SYSGRID_WORKSTATION_REEXECUTED=1
    export SYSGRID_WORKSTATION_SKIP_SYNC_ON_REEXEC=1
    exec bash "$ROOT_DIR/scripts/workstation-up.sh" "${ORIGINAL_ARGS[@]}"
  fi
}

check_dns() {
  if [[ "$SKIP_DNS_CHECK" == "true" || "${SYSGRID_SKIP_DNS_CHECK:-0}" == "1" ]]; then
    echo "WARNING: forwarded DNS resolution check skipped."
    return 0
  fi
  python3 - "$(origin_hostname "$API_BASE_URL")" "$(origin_hostname "$FRONTEND_ORIGIN")" <<'PY'
import socket
import sys
failed = []
for host in dict.fromkeys(sys.argv[1:]):
    if host in {"localhost", "127.0.0.1", "::1"}:
        continue
    try:
        socket.getaddrinfo(host, None)
    except OSError as exc:
        failed.append(f"{host}: {exc}")
if failed:
    raise SystemExit("Forwarded DNS resolution failed:\n  " + "\n  ".join(failed))
print("Forwarded DNS resolution: PASS")
PY
}

install_dependencies() {
  local requirements="$ROOT_DIR/backend/requirements.txt"
  local lockfile="$ROOT_DIR/frontend/package-lock.json"
  local backend_python="$ROOT_DIR/backend/venv/bin/python"
  [[ -f "$requirements" ]] || { echo "Missing $requirements" >&2; exit 1; }
  [[ -f "$ROOT_DIR/frontend/package.json" ]] || { echo "Missing frontend/package.json" >&2; exit 1; }

  if [[ -x "$backend_python" ]]; then
    if ! "$backend_python" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
    then
      echo "Recreating backend virtual environment for Python 3.11+..."
      rm -rf "$ROOT_DIR/backend/venv"
    fi
  fi
  if [[ ! -x "$backend_python" ]]; then
    echo "Creating backend virtual environment..."
    python3 -m venv "$ROOT_DIR/backend/venv"
  fi

  local req_hash req_stamp
  req_hash="$(sha256_file "$requirements")"
  req_stamp="$ROOT_DIR/backend/venv/.sysgrid-requirements.sha256"
  if [[ ! -f "$req_stamp" || "$(cat "$req_stamp" 2>/dev/null || true)" != "$req_hash" ]]; then
    echo "Installing backend dependencies..."
    "$backend_python" -m pip install -r "$requirements"
    printf '%s\n' "$req_hash" > "$req_stamp"
  else
    echo "Backend dependencies are current."
  fi

  if [[ -f "$lockfile" ]]; then
    local lock_hash lock_stamp
    lock_hash="$(sha256_file "$lockfile")"
    lock_stamp="$ROOT_DIR/frontend/node_modules/.sysgrid-package-lock.sha256"
    if [[ ! -d "$ROOT_DIR/frontend/node_modules" || ! -f "$lock_stamp" || "$(cat "$lock_stamp" 2>/dev/null || true)" != "$lock_hash" ]]; then
      echo "Installing frontend dependencies from package-lock.json..."
      (cd "$ROOT_DIR/frontend" && npm ci)
      printf '%s\n' "$lock_hash" > "$lock_stamp"
    else
      echo "Frontend dependencies are current."
    fi
  elif [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    (cd "$ROOT_DIR/frontend" && npm install)
  else
    echo "Frontend dependencies are present."
  fi
}

check_dependency_state() {
  local failures=0
  if [[ ! -x "$ROOT_DIR/backend/venv/bin/python" ]]; then
    echo "Backend virtual environment: MISSING"
    failures=$((failures + 1))
  else
    echo "Backend virtual environment: PRESENT"
  fi
  if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    echo "Frontend node_modules: MISSING"
    failures=$((failures + 1))
  else
    echo "Frontend node_modules: PRESENT"
  fi
  return "$failures"
}

backup_uat_data() {
  local config_db="$ROOT_DIR/backend/config.local.db"
  local tenant_root="$ROOT_DIR/backend/tenants/local-demo"
  [[ -e "$config_db" || -e "$tenant_root" ]] || return 0
  local timestamp backup_file
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$DATA_BACKUP_ROOT"
  backup_file="$DATA_BACKUP_ROOT/local-demo-$timestamp.tar.gz"
  python3 - "$ROOT_DIR/backend" "$backup_file" <<'PY'
import pathlib
import sys
import tarfile
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
with tarfile.open(out, "w:gz") as archive:
    for rel in (pathlib.Path("config.local.db"), pathlib.Path("tenants/local-demo")):
        path = root / rel
        if path.exists() or path.is_symlink():
            archive.add(path, arcname=str(rel), recursive=True)
PY
  echo "Existing Local Demo data backed up: $backup_file"
}

runtime_run_dir() {
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$RUNS_ROOT"
  RUN_DIR="$RUNS_ROOT/$timestamp"
  mkdir -p "$RUN_DIR"
  rm -f "$PROFILE_DIR/latest-run"
  ln -s "$RUN_DIR" "$PROFILE_DIR/latest-run" 2>/dev/null || true
}

start_runtime() {
  runtime_run_dir
  if [[ "$DATA_MODE" != "resume" ]]; then
    backup_uat_data
  fi

  local data_args public_args strict_args
  data_args="--seed-data"
  case "$DATA_MODE" in
    fresh-full) data_args="--seed-data" ;;
    fresh-foundation) data_args="--no-seed-data" ;;
    resume) data_args="--preserve-data" ;;
  esac
  public_args=""
  case "$PUBLIC_FRONTEND_POLICY" in
    warn) public_args="" ;;
    require) public_args="--require-public-frontend" ;;
    skip) public_args="--skip-public-frontend-probe" ;;
  esac
  strict_args=""
  [[ "$STRICT_CHECKS" == "true" ]] && strict_args="--strict-checks"

  export "$USER_ID_ENV_VAR=$RUNTIME_EFFECTIVE_USER_ID"
  printf '%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)" > "$RUN_DIR/git-head.txt"
  print_config > "$RUN_DIR/resolved-profile.txt"

  echo
  echo "Launching SysGrid UAT. Keep this Terminal open."
  echo "Frontend: $FRONTEND_ORIGIN"
  echo "API:      $API_BASE_URL"
  echo "Health:   $API_BASE_URL/api/v1/health"
  echo "Evidence: $RUN_DIR"
  echo

  local args
  args=(
    --backend-host "$BACKEND_HOST"
    --backend-port "$BACKEND_PORT"
    --frontend-host "$FRONTEND_HOST"
    --frontend-port "$FRONTEND_PORT"
    --api-base-url "$API_BASE_URL"
    --frontend-origin "$FRONTEND_ORIGIN"
    --default-user-id "$DEFAULT_USER_ID"
    --auto-admin-user-ids "$AUTO_ADMIN_USER_IDS"
    --admin-full-name "$ADMIN_FULL_NAME"
    --admin-email "$ADMIN_EMAIL"
    --admin-department "$ADMIN_DEPARTMENT"
    --user-id-env-var "$USER_ID_ENV_VAR"
    --runtime-effective-user-id "$RUNTIME_EFFECTIVE_USER_ID"
    --profile-name "$PROFILE_NAME"
    --runtime-log-dir "$RUN_DIR"
    --runtime-report-file "$RUN_DIR/runtime-report.json"
  )
  [[ -n "$BUGANIZER_URL" ]] && args+=(--buganizer-url "$BUGANIZER_URL")
  args+=("$data_args")
  [[ -n "$public_args" ]] && args+=("$public_args")
  [[ -n "$strict_args" ]] && args+=("$strict_args")

  bash "$ROOT_DIR/scripts/start-local.sh" "${args[@]}"
}

run_validation() {
  echo "Running workstation/UAT validation..."
  bash -n "$ROOT_DIR/scripts/workstation-up.sh"
  bash -n "$ROOT_DIR/scripts/start-local.sh"
  "$ROOT_DIR/backend/venv/bin/python" -m py_compile "$ROOT_DIR/seed.py"
  "$ROOT_DIR/backend/venv/bin/python" -m pytest -q "$ROOT_DIR/scripts/tests/test_runtime_origin_config.py"
  bash "$ROOT_DIR/scripts/start-local.sh" \
    --backend-host "$BACKEND_HOST" \
    --backend-port "$BACKEND_PORT" \
    --frontend-host "$FRONTEND_HOST" \
    --frontend-port "$FRONTEND_PORT" \
    --api-base-url "$API_BASE_URL" \
    --frontend-origin "$FRONTEND_ORIGIN" \
    --default-user-id "$DEFAULT_USER_ID" \
    --auto-admin-user-ids "$AUTO_ADMIN_USER_IDS" \
    --admin-full-name "$ADMIN_FULL_NAME" \
    --admin-email "$ADMIN_EMAIL" \
    --admin-department "$ADMIN_DEPARTMENT" \
    --user-id-env-var "$USER_ID_ENV_VAR" \
    --runtime-effective-user-id "$RUNTIME_EFFECTIVE_USER_ID" \
    --profile-name "$PROFILE_NAME" \
    --print-runtime-config
  echo "Workstation/UAT validation: PASS"
}

run_doctor() {
  local head origin_main status
  echo
  echo "SYSGRID WORKSTATION DOCTOR"
  echo "--------------------------"
  print_config
  echo
  check_versions || true
  check_repository || true
  head="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  origin_main="$(git -C "$ROOT_DIR" rev-parse origin/main 2>/dev/null || true)"
  status="$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)"
  echo "Git HEAD:               ${head:-<unavailable>}"
  echo "Git origin/main:        ${origin_main:-<unavailable>}"
  if [[ -n "$head" && "$head" == "$origin_main" ]]; then
    echo "Remote equality:        PASS"
  else
    echo "Remote equality:        NOT CONFIRMED"
  fi
  if [[ -z "$status" ]]; then echo "Working tree:           CLEAN"; else echo "Working tree:           DIRTY"; fi
  check_dependency_state || true
  check_dns || true
  echo "Backend port listeners: $(lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
  echo "Frontend port listeners: $(lsof -tiTCP:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
  local health_status frontend_status
  health_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$BACKEND_HOST:$BACKEND_PORT/api/v1/health" 2>/dev/null || true)"
  frontend_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$FRONTEND_HOST:$FRONTEND_PORT" 2>/dev/null || true)"
  echo "Local backend health:   ${health_status:-000}"
  echo "Local frontend status:  ${frontend_status:-000}"
  echo "Latest run evidence:    $PROFILE_DIR/latest-run"
}

create_diagnostics() {
  mkdir -p "$DIAGNOSTICS_ROOT"
  local timestamp work_dir zip_path head origin_main
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  work_dir="$(mktemp -d -t sysgrid-uat-diagnostics)"
  zip_path="$DIAGNOSTICS_ROOT/SYSGRID_UAT_DIAGNOSTICS_${PROFILE_NAME}_${timestamp}.zip"
  head="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  origin_main="$(git -C "$ROOT_DIR" rev-parse origin/main 2>/dev/null || true)"

  print_config > "$work_dir/resolved-profile.txt"
  git -C "$ROOT_DIR" status --short --branch > "$work_dir/git-status.txt" 2>&1 || true
  git -C "$ROOT_DIR" log -1 --format=fuller > "$work_dir/git-latest-commit.txt" 2>&1 || true
  check_dns > "$work_dir/dns-check.txt" 2>&1 || true
  lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN > "$work_dir/backend-port.txt" 2>&1 || true
  lsof -nP -iTCP:"$FRONTEND_PORT" -sTCP:LISTEN > "$work_dir/frontend-port.txt" 2>&1 || true
  curl -sS --max-time 10 -D "$work_dir/backend-health-headers.txt" -o "$work_dir/backend-health-body.txt" \
    "http://$BACKEND_HOST:$BACKEND_PORT/api/v1/health" || true
  curl -sS --max-time 10 -D "$work_dir/frontend-local-headers.txt" -o "$work_dir/frontend-local-body.html" \
    "http://$FRONTEND_HOST:$FRONTEND_PORT" || true
  curl -sS --max-time 10 -D "$work_dir/public-api-headers.txt" -o "$work_dir/public-api-body.txt" \
    "$API_BASE_URL/api/v1/health" || true
  curl -sS --max-time 10 -D "$work_dir/public-frontend-headers.txt" -o "$work_dir/public-frontend-body.html" \
    "$FRONTEND_ORIGIN" || true

  if [[ -L "$PROFILE_DIR/latest-run" || -d "$PROFILE_DIR/latest-run" ]]; then
    local latest_target
    latest_target="$(cd "$PROFILE_DIR/latest-run" 2>/dev/null && pwd || true)"
    if [[ -n "$latest_target" ]]; then
      mkdir -p "$work_dir/latest-run"
      for file in runtime-report.json resolved-profile.txt git-head.txt typecheck.log; do
        [[ -f "$latest_target/$file" ]] && cp "$latest_target/$file" "$work_dir/latest-run/$file"
      done
      for file in backend.log frontend.log; do
        if [[ -f "$latest_target/$file" ]]; then
          python3 - "$latest_target/$file" "$work_dir/latest-run/$file" <<'PY_LOG_TAIL'
import pathlib
import sys
src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
limit = 2 * 1024 * 1024
data = src.read_bytes()
if len(data) > limit:
    data = b"[truncated to final 2 MiB]\n" + data[-limit:]
dst.write_bytes(data)
PY_LOG_TAIL
        fi
      done
    fi
  fi

  DIAG_PROFILE="$PROFILE_NAME" DIAG_CREATED_AT="$timestamp" DIAG_HEAD="$head" DIAG_ORIGIN_MAIN="$origin_main" \
  DIAG_WORK_DIR="$work_dir" DIAG_ZIP_PATH="$zip_path" python3 - <<'PY'
import json
import os
import pathlib
import re
import zipfile

root = pathlib.Path(os.environ["DIAG_WORK_DIR"])
summary = {
    "schema_version": "1.0.0",
    "classification": "SYSGRID_UAT_DIAGNOSTICS",
    "profile": os.environ["DIAG_PROFILE"],
    "created_at_compact_utc": os.environ["DIAG_CREATED_AT"],
    "git_head": os.environ["DIAG_HEAD"],
    "git_origin_main": os.environ["DIAG_ORIGIN_MAIN"],
}
(root / "SUMMARY.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

secret_patterns = [
    re.compile(r"(?i)(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie)(\s*[:=]\s*)([^\s]+)"),
]
for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() in {".zip", ".png", ".jpg", ".jpeg"}:
        continue
    try:
        text = path.read_text(errors="replace")
    except OSError:
        continue
    for pattern in secret_patterns:
        text = pattern.sub(lambda m: m.group(1) + m.group(2) + "<REDACTED>", text)
    path.write_text(text)

zip_path = pathlib.Path(os.environ["DIAG_ZIP_PATH"])
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(root).as_posix())
PY
  rm -rf "$work_dir"
  echo "Sanitized UAT diagnostics: $zip_path"
  echo "SHA-256: $(sha256_file "$zip_path")"
}

run_self_test() {
  local got
  got="$(normalize_origin 'http://8000.vscode.example.com/')"
  [[ "$got" == "http://8000.vscode.example.com" ]]
  got="$(proxy_origin 'https://{{port}}-host.example.com' 5173)"
  [[ "$got" == "https://5173-host.example.com" ]]
  if normalize_origin 'https://host.example.com/api/v1' >/dev/null 2>&1; then
    echo "Self-test failed: origin path was accepted" >&2
    exit 1
  fi
  validate_data_mode fresh-full
  validate_data_mode fresh-foundation
  validate_data_mode resume
  validate_public_policy warn
  validate_public_policy require
  validate_public_policy skip
  if validate_port 70000 >/dev/null 2>&1; then
    echo "Self-test failed: invalid port was accepted" >&2
    exit 1
  fi
  bash -n "$ROOT_DIR/scripts/start-local.sh"
  python3 -m py_compile "$ROOT_DIR/seed.py"
  python3 - "$ROOT_DIR/seed.py" <<'PY_SEED_CONTRACT'
import pathlib
import sys
text = pathlib.Path(sys.argv[1]).read_text()
required = (
    '--admin-full-name',
    '--admin-email',
    '--admin-department',
    'full_name=args.admin_full_name',
    'email=args.admin_email',
    'department=args.admin_department',
)
missing = [value for value in required if value not in text]
if missing:
    raise SystemExit('seed CLI contract missing: ' + ', '.join(missing))
PY_SEED_CONTRACT
  SYSGRID_SKIP_WORKSTATION_SELF_TEST=1 bash "$ROOT_DIR/scripts/start-local.sh" \
    --api-base-url http://8000.vscode.example.com/ \
    --frontend-origin http://5173.vscode.example.com/ \
    --preserve-data \
    --print-runtime-config | grep -q 'Data mode:                preserve'
  echo "SysGrid workstation/UAT launcher self-test: PASS"
}

if [[ "$SELF_TEST" == "true" ]]; then
  require_command python3
  run_self_test
  exit 0
fi

check_repository
resolve_config
print_config

if [[ "$COMMAND" == "configure" ]]; then
  exit 0
fi
if [[ "$PRINT_CONFIG_ONLY" == "true" ]]; then
  exit 0
fi

check_versions

if [[ "${SYSGRID_WORKSTATION_SKIP_SYNC_ON_REEXEC:-0}" == "1" ]]; then
  SYNC_MAIN="false"
fi
if [[ "$SYNC_MAIN" == "true" && "$COMMAND" != "doctor" && "$COMMAND" != "diagnostics" ]]; then
  sync_main
  if [[ "${SYSGRID_WORKSTATION_REEXECUTED:-0}" != "1" ]]; then
    # sync_main returns only when no re-exec was needed.
    :
  fi
fi

check_dns

case "$COMMAND" in
  doctor)
    run_doctor
    ;;
  diagnostics)
    create_diagnostics
    ;;
  validate)
    if [[ "$INSTALL_DEPENDENCIES" == "true" ]]; then install_dependencies; else check_dependency_state; fi
    run_validation
    ;;
  start|reset)
    if [[ "$INSTALL_DEPENDENCIES" == "true" ]]; then install_dependencies; else check_dependency_state; fi
    start_runtime
    ;;
esac
