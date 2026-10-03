from pathlib import Path
import json
import socket
import subprocess
import sys

import pytest


LIBRARY = Path(__file__).resolve().parents[1] / 'lib/verify-runtime.sh'


@pytest.mark.parametrize('configured', [True, False])
def test_busy_port_stops_before_any_runtime_can_be_started(configured):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        port = listener.getsockname()[1]
        script = '''
occupied_port="$3"
source "$1"
PYTHON_BIN="$2"
if [[ "$4" == "auto" ]]; then
  verify_runtime_allocate_port() { printf '%s' "$occupied_port"; }
  selected="$(verify_runtime_select_port "" frontend)"
else
  selected="$(verify_runtime_select_port "$3" frontend)"
fi
printf 'UNSAFE_CONTINUATION=%s\n' "$selected"
'''
        result = subprocess.run(['bash', '-c', script, 'test', str(LIBRARY), sys.executable, str(port), 'configured' if configured else 'auto'], text=True, capture_output=True)
        assert result.returncode != 0, 'BUSY_PORT_FAIL_CLOSED: port rejection was swallowed by command substitution'
        assert 'UNSAFE_CONTINUATION' not in result.stdout
        assert 'Refusing to reuse an unmanaged frontend listener' in result.stderr
        # The gate must not terminate a listener it does not own.
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            pass


def test_cleanup_reaps_owned_processes_and_releases_ports(tmp_path):
    with socket.socket() as allocated:
        allocated.bind(('127.0.0.1', 0))
        port = allocated.getsockname()[1]
    script = '''
source "$1"
PYTHON_BIN="$2"
VERIFY_RUNTIME_DIR="$4"
VERIFY_RUNTIME_LOG_DIR="$4"
SYSGRID_VERIFY_KEEP_LOGS=1
"$PYTHON_BIN" -m http.server "$3" --bind 127.0.0.1 >"$4/server.log" 2>&1 &
VERIFY_RUNTIME_FRONTEND_PID=$!
trap verify_runtime_cleanup EXIT
verify_runtime_wait_for_url "http://127.0.0.1:$3" owned-test-server
verify_runtime_cleanup
if kill -0 "$VERIFY_RUNTIME_FRONTEND_PID" 2>/dev/null; then
  echo 'OWNED_PROCESS_NOT_REAPED' >&2
  exit 1
fi
verify_runtime_assert_port_free "$3" frontend
verify_runtime_cleanup
'''
    result = subprocess.run(['bash', '-c', script, 'test', str(LIBRARY), sys.executable, str(port), str(tmp_path)], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr


def test_actual_frontend_is_owned_and_can_restart_on_the_same_port(tmp_path):
    with socket.socket() as allocated:
        allocated.bind(('127.0.0.1', 0))
        port = allocated.getsockname()[1]
    script = '''
source "$1"
PYTHON_BIN="$2"
verify_runtime_resolve_node
VERIFY_RUNTIME_DIR="$4"
VERIFY_RUNTIME_LOG_DIR="$4"
VERIFY_RUNTIME_FRONTEND_PORT="$3"
VERIFY_RUNTIME_FRONTEND_ORIGIN="http://127.0.0.1:$3"
VERIFY_RUNTIME_FRONTEND_URL="$VERIFY_RUNTIME_FRONTEND_ORIGIN"
VERIFY_RUNTIME_BACKEND_ORIGIN="http://127.0.0.1:1"
SYSGRID_VERIFY_KEEP_LOGS=1
trap verify_runtime_cleanup EXIT
for pass in first second; do
  VERIFY_RUNTIME_CLEANED=false
  verify_runtime_assert_port_free "$3" frontend
  verify_runtime_start_frontend
  command="$(ps -ww -p "$VERIFY_RUNTIME_FRONTEND_PID" -o command=)"
  [[ "$command" == *vite/bin/vite.js* ]] || { echo "FRONTEND_PID_IS_NOT_VITE: $command" >&2; exit 1; }
  "$PYTHON_BIN" - "$VERIFY_RUNTIME_FRONTEND_ORIGIN" "$VERIFY_RUNTIME_DIR" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.request import urlopen

origin, directory = sys.argv[1:]
html = urlopen(origin).read().decode()
assert '/@vite/client' not in html, 'Browser qualification must not execute the development client'
scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
assert scripts and all(path.startswith('/assets/') for path in scripts)
receipt = json.loads((Path(directory) / 'frontend-build.json').read_text())
assert receipt['mode'] == 'production'
for path in scripts:
    response = urlopen(origin + path)
    assert 'javascript' in response.headers['Content-Type']
    assert hashlib.sha256(response.read()).hexdigest() == receipt['files'][path.lstrip('/')]['sha256']
PY
  verify_runtime_cleanup
  verify_runtime_assert_port_free "$3" frontend
done
'''
    result = subprocess.run(['bash', '-c', script, 'test', str(LIBRARY), sys.executable, str(port), str(tmp_path)], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr


def test_failed_frontend_build_never_starts_a_server(tmp_path):
    frontend = tmp_path / 'frontend'
    entry = frontend / 'node_modules/vite/bin/vite.js'
    entry.parent.mkdir(parents=True)
    entry.write_text('/* Intentional build failure fixture. */')
    fake_node = tmp_path / 'node'
    fake_node.write_text('#!/usr/bin/env python3\nimport json, sys\nfrom pathlib import Path\nPath(__file__).with_suffix(".calls").write_text(json.dumps(sys.argv[1:]))\nraise SystemExit(17)\n')
    fake_node.chmod(0o700)
    runtime = tmp_path / 'owned'
    runtime.mkdir()
    script = '''
source "$1"
PYTHON_BIN="$2"
NODE_BIN="$3"
VERIFY_RUNTIME_FRONTEND_DIR="$4"
VERIFY_RUNTIME_DIR="$5"
VERIFY_RUNTIME_LOG_DIR="$5"
VERIFY_RUNTIME_FRONTEND_PORT=12345
VERIFY_RUNTIME_FRONTEND_ORIGIN=http://127.0.0.1:12345
VERIFY_RUNTIME_FRONTEND_URL="$VERIFY_RUNTIME_FRONTEND_ORIGIN"
VERIFY_RUNTIME_BACKEND_ORIGIN=http://127.0.0.1:1
SYSGRID_VERIFY_KEEP_LOGS=1
trap verify_runtime_cleanup EXIT
verify_runtime_wait_for_url() { echo UNEXPECTED_SERVER_WAIT; }
if verify_runtime_start_frontend; then echo UNSAFE_BUILD_CONTINUATION; exit 1; fi
[[ -z "$VERIFY_RUNTIME_FRONTEND_PID" ]]
'''
    result = subprocess.run(['bash', '-c', script, 'test', str(LIBRARY), sys.executable, str(fake_node), str(frontend), str(runtime)], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert 'UNSAFE_BUILD_CONTINUATION' not in result.stdout
    assert 'UNEXPECTED_SERVER_WAIT' not in result.stdout
    arguments = json.loads(fake_node.with_suffix('.calls').read_text())
    assert arguments[1] == 'build'
    assert not (runtime / 'frontend-build.json').exists()
