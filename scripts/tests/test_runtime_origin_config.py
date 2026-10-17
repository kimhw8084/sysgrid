from pathlib import Path
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from scripts.runtime_origin_config import RuntimeOriginError, resolve_runtime_origins


def test_forwarded_origins_are_normalized_and_merged():
    runtime = resolve_runtime_origins(
        api_base_url="http://8000.vscode.company.example/",
        frontend_origin="http://5173.vscode.company.example/",
        backend_host="127.0.0.1",
        backend_port=8000,
        frontend_host="127.0.0.1",
        frontend_port=5173,
        allowed_hosts="internal-api",
        cors_origins="https://existing.example",
    )

    assert runtime.api_base_url == "http://8000.vscode.company.example"
    assert runtime.frontend_origin == "http://5173.vscode.company.example"
    assert runtime.api_hostname == "8000.vscode.company.example"
    assert runtime.allowed_hosts.split(",") == [
        "internal-api",
        "8000.vscode.company.example",
        "127.0.0.1",
        "localhost",
        "test",
        "testserver",
    ]
    assert runtime.cors_origins.split(",") == [
        "https://existing.example",
        "http://5173.vscode.company.example",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]


def test_api_base_rejects_paths():
    try:
        resolve_runtime_origins(
            api_base_url="https://api.example.com/api/v1",
            frontend_origin="https://ui.example.com",
            backend_host="127.0.0.1",
            backend_port=8000,
            frontend_host="127.0.0.1",
            frontend_port=5173,
        )
    except RuntimeOriginError as exc:
        assert "origin only" in str(exc)
    else:
        raise AssertionError("expected RuntimeOriginError")


def test_https_frontend_rejects_http_api():
    try:
        resolve_runtime_origins(
            api_base_url="http://api.example.com",
            frontend_origin="https://ui.example.com",
            backend_host="127.0.0.1",
            backend_port=8000,
            frontend_host="127.0.0.1",
            frontend_port=5173,
        )
    except RuntimeOriginError as exc:
        assert "Mixed-content" in str(exc)
    else:
        raise AssertionError("expected RuntimeOriginError")


def test_start_local_restores_tracked_runtime_env_on_exit():
    script = (Path(__file__).resolve().parents[1] / "start-local.sh").read_text(encoding="utf-8")

    assert 'BACKEND_ENV_BACKUP_FILE="$(mktemp "${TMPDIR:-/tmp}/sysgrid-backend-env.XXXXXX")"' in script
    assert 'restore_backend_runtime_env()' in script
    assert 'cp -p "$BACKEND_ENV_BACKUP_FILE" "$LOCAL_BACKEND_ENV_FILE"' in script
    assert 'restore_backend_runtime_env || true' in script
    assert 'trap cleanup EXIT INT TERM' in script


def _public_frontend_probe(tmp_path, *, status=200, header='Content-Type', value='text/html; charset=utf-8', required=True):
    script = (Path(__file__).resolve().parents[1] / 'start-local.sh').read_text()
    # Exercise the real shell function without launching or editing a user's runtime.
    function = 'probe_public_frontend() {' + script.split('\nprobe_public_frontend() {', 1)[1].split('\nwrite_runtime_report() {', 1)[0]

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(status)
            self.send_header(header, value)
            self.end_headers()
            self.wfile.write(b'<!doctype html><title>Disposable frontend probe fixture</title>')

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
    thread.start()
    try:
        return subprocess.run(['bash', '-euc', function + '\nprobe_public_frontend'],
            env={**os.environ, 'TMPDIR': str(tmp_path), 'PUBLIC_FRONTEND_PROBE': 'true',
                 'REQUIRE_PUBLIC_FRONTEND': str(required).lower(),
                 'FRONTEND_ORIGIN': f'http://127.0.0.1:{server.server_port}'},
            text=True, capture_output=True, timeout=20)
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


@pytest.mark.parametrize('header', ['content-type', 'Content-Type', 'cOnTeNt-TyPe'])
def test_public_frontend_accepts_html_independent_of_header_name_case(tmp_path, header):
    result = _public_frontend_probe(tmp_path, header=header)
    assert result.returncode == 0, result.stderr
    assert 'Browser-visible frontend probe: PASS' in result.stdout
    assert 'WARNING' not in result.stderr
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('status,value', [(200, 'application/json'), (503, 'text/html')])
def test_public_frontend_strict_probe_still_rejects_non_application_responses(tmp_path, status, value):
    result = _public_frontend_probe(tmp_path, status=status, value=value)
    assert result.returncode != 0
    assert 'Strict public frontend proof was requested; refusing to continue.' in result.stderr
    assert 'Browser-visible frontend probe: PASS' not in result.stdout
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('header', ['Location', 'lOcAtIoN'])
def test_public_frontend_preserves_case_sensitive_redirect_destination(tmp_path, header):
    result = _public_frontend_probe(tmp_path, status=302, header=header, value='https://login.example/SignIn?ReturnTo=SysGrid')
    assert result.returncode != 0
    assert 'HTTP 302 -> https://login.example/SignIn?ReturnTo=SysGrid' in result.stdout
    assert 'Browser-visible frontend probe: PASS' not in result.stdout
    assert list(tmp_path.iterdir()) == []


def test_public_frontend_optional_probe_reports_warning_without_stopping(tmp_path):
    result = _public_frontend_probe(tmp_path, value='application/json', required=False)
    assert result.returncode == 0
    assert 'WARNING: browser-visible frontend probe did not return application HTML' in result.stderr
    assert 'Browser-visible frontend probe: PASS' not in result.stdout
    assert list(tmp_path.iterdir()) == []
