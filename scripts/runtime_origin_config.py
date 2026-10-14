#!/usr/bin/env python3
"""Resolve SysGrid local/forwarded runtime origins without weakening production policy."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shlex
import sys
from dataclasses import asdict, dataclass
from urllib.parse import urlparse

if __package__:
    from .source_integrity_gate import SourceIntegrityError, enforce_current_main, render_source_banner
else:
    from source_integrity_gate import SourceIntegrityError, enforce_current_main, render_source_banner


DEFAULT_ALLOWED_HOSTS = ("localhost", "127.0.0.1", "test", "testserver")


class RuntimeOriginError(ValueError):
    pass


def normalize_origin(value: str, label: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        raise RuntimeOriginError(f"{label} is required.")
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeOriginError(
            f'{label} must be an explicit http(s) origin, for example '
            f'"https://service.example.com". Received: {candidate!r}'
        )
    if parsed.username or parsed.password:
        raise RuntimeOriginError(f"{label} must not contain embedded credentials.")
    if parsed.query or parsed.fragment:
        raise RuntimeOriginError(f"{label} must not contain a query string or fragment.")
    if parsed.path not in {"", "/"}:
        raise RuntimeOriginError(
            f"{label} must be the origin only and must not include a path. "
            f"Received path: {parsed.path!r}"
        )
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = host
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return f"{parsed.scheme}://{netloc}"


def merge_csv(*values: str) -> str:
    merged: list[str] = []
    for value in values:
        for item in (value or "").split(","):
            item = item.strip()
            if item and item not in merged:
                merged.append(item)
    return ",".join(merged)


@dataclass(frozen=True)
class RuntimeOrigins:
    api_base_url: str
    api_hostname: str
    api_scheme: str
    frontend_origin: str
    frontend_hostname: str
    frontend_scheme: str
    allowed_hosts: str
    cors_origins: str
    local_health_url: str
    public_health_url: str
    local_frontend_url: str


def resolve_runtime_origins(
    *,
    api_base_url: str,
    frontend_origin: str,
    backend_host: str,
    backend_port: int,
    frontend_host: str,
    frontend_port: int,
    allowed_hosts: str = "",
    cors_origins: str = "",
) -> RuntimeOrigins:
    api_origin = normalize_origin(api_base_url, "API base URL")
    ui_origin = normalize_origin(frontend_origin, "Frontend origin")
    api = urlparse(api_origin)
    ui = urlparse(ui_origin)

    if ui.scheme == "https" and api.scheme == "http":
        raise RuntimeOriginError(
            "Mixed-content configuration is invalid: an HTTPS frontend cannot call an HTTP API. "
            "Use the exact HTTPS forwarded API origin or run both origins over HTTP."
        )

    api_hostname = api.hostname or ""
    frontend_hostname = ui.hostname or ""
    normalized_allowed_hosts = merge_csv(
        allowed_hosts,
        api_hostname,
        backend_host,
        ",".join(DEFAULT_ALLOWED_HOSTS),
    )
    normalized_cors_origins = merge_csv(
        cors_origins,
        ui_origin,
        f"http://{frontend_host}:{frontend_port}",
        f"http://localhost:{frontend_port}",
        f"http://127.0.0.1:{frontend_port}",
    )

    return RuntimeOrigins(
        api_base_url=api_origin,
        api_hostname=api_hostname,
        api_scheme=api.scheme,
        frontend_origin=ui_origin,
        frontend_hostname=frontend_hostname,
        frontend_scheme=ui.scheme,
        allowed_hosts=normalized_allowed_hosts,
        cors_origins=normalized_cors_origins,
        local_health_url=f"http://{backend_host}:{backend_port}/api/v1/health",
        public_health_url=f"{api_origin}/api/v1/health",
        local_frontend_url=f"http://{frontend_host}:{frontend_port}",
    )


def shell_assignments(runtime: RuntimeOrigins) -> str:
    values = {
        "API_BASE_URL": runtime.api_base_url,
        "API_PUBLIC_HOSTNAME": runtime.api_hostname,
        "API_SCHEME": runtime.api_scheme,
        "FRONTEND_ORIGIN": runtime.frontend_origin,
        "FRONTEND_PUBLIC_HOSTNAME": runtime.frontend_hostname,
        "FRONTEND_SCHEME": runtime.frontend_scheme,
        "ALLOWED_HOSTS": runtime.allowed_hosts,
        "BACKEND_CORS_ORIGINS": runtime.cors_origins,
        "LOCAL_HEALTH_URL": runtime.local_health_url,
        "PUBLIC_HEALTH_URL": runtime.public_health_url,
        "LOCAL_FRONTEND_URL": runtime.local_frontend_url,
    }
    return "\n".join(f"{key}={shlex.quote(value)}" for key, value in values.items())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--frontend-origin", required=True)
    parser.add_argument("--backend-host", required=True)
    parser.add_argument("--backend-port", required=True, type=int)
    parser.add_argument("--frontend-host", required=True)
    parser.add_argument("--frontend-port", required=True, type=int)
    parser.add_argument("--allowed-hosts", default="")
    parser.add_argument("--cors-origins", default="")
    parser.add_argument("--format", choices=("shell", "json"), default="shell")
    parser.add_argument("--source-policy", choices=("enforce", "inspect"), default="enforce", help="Inspection resolves configuration without launching or mutating Git.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[1]
    if args.source_policy == "enforce":
        try:
            source_result = enforce_current_main(repo_root)
        except SourceIntegrityError as exc:
            raise SystemExit(f"SYSGRID_SOURCE_INTEGRITY_FAIL status={exc.status}: {exc}") from exc
        print(render_source_banner(source_result), file=sys.stderr)
        if source_result.fast_forwarded and os.environ.get("SYSGRID_SOURCE_GATE_REEXECUTED") != "1":
            os.environ["SYSGRID_SOURCE_GATE_REEXECUTED"] = "1"
            os.execv(sys.executable, [sys.executable, str(pathlib.Path(__file__).resolve()), *sys.argv[1:]])
    try:
        runtime = resolve_runtime_origins(
            api_base_url=args.api_base_url,
            frontend_origin=args.frontend_origin,
            backend_host=args.backend_host,
            backend_port=args.backend_port,
            frontend_host=args.frontend_host,
            frontend_port=args.frontend_port,
            allowed_hosts=args.allowed_hosts,
            cors_origins=args.cors_origins,
        )
    except RuntimeOriginError as exc:
        raise SystemExit(f"RUNTIME_ORIGIN_ERROR: {exc}") from exc

    if args.format == "json":
        print(json.dumps(asdict(runtime), indent=2, sort_keys=True))
    else:
        print(shell_assignments(runtime))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
