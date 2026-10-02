#!/usr/bin/env bash

# These checks run before startup mutates a checkout, data, or another process.
sysgrid_sync_main() {
  local root="$1"
  [[ "$(git -C "$root" branch --show-current)" == "main" ]] || {
    echo "Refusing synchronization: switch to main after preserving your current work, or use --skip-sync." >&2
    return 1
  }
  [[ -z "$(git -C "$root" status --porcelain=v1 --untracked-files=all)" ]] || {
    echo "Refusing synchronization: the checkout has local changes. Preserve them before updating main." >&2
    return 1
  }
  git -C "$root" fetch origin refs/heads/main:refs/remotes/origin/main || return 1
  git -C "$root" merge-base --is-ancestor HEAD origin/main || {
    echo "Refusing synchronization: main has local commits or diverges from origin/main." >&2
    return 1
  }
  git -C "$root" merge --ff-only origin/main
}

sysgrid_require_free_port() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || {
    echo "lsof is required to establish port ownership before startup." >&2
    return 1
  }
  if [[ -n "$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
    echo "Port $port is occupied. Stop its owner explicitly or choose another port; startup will not terminate it." >&2
    return 1
  fi
}

sysgrid_local_data_action() {
  local mode="$1" config="$2" tenant="$3" tenant_root="$4"
  if [[ "$mode" == "reset" ]]; then
    printf '%s\n' reset
  elif [[ -f "$config" && -f "$tenant" ]]; then
    printf '%s\n' preserve
  elif [[ ! -e "$config" && ! -e "$tenant_root" ]]; then
    printf '%s\n' initialize
  else
    echo "Incomplete Local Demo data found. Startup will not overwrite it. Restore the missing files or choose an explicit archived reset." >&2
    return 1
  fi
}

sysgrid_archive_local_data() {
  local config="$1" tenant_root="$2" backup_root="$3" archive
  [[ -e "$config" || -e "$tenant_root" ]] || return 0
  # Include SQLite sidecars and every tenant file. Never delete an old dataset.
  mkdir -p "$backup_root" || return 1
  archive="$(mktemp -d "$backup_root/local-demo.XXXXXXXX")" || return 1
  local file
  for file in "$config" "$config-wal" "$config-shm" "$tenant_root"; do
    if [[ -e "$file" ]]; then
      mv "$file" "$archive/" || return 1
    fi
  done
  echo "Previous Local Demo data retained at $archive"
}
