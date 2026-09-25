from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "production-lifecycle.py"
SPEC = importlib.util.spec_from_file_location("production_lifecycle", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def readiness_server(readiness_status: int = 200, *, redirect_readiness: bool = False):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/v1/health":
                status = 200
                payload = {"status": "online", "alive": True}
            elif self.path == "/api/v1/readiness" and redirect_readiness:
                self.send_response(302)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            elif self.path == "/api/v1/readiness":
                status = readiness_status
                payload = {
                    "status": "ready" if status == 200 else "not_ready",
                    "dependencies": {
                        name: {"ready": True}
                        for name in ("config_database", "default_database", "production_guard")
                    },
                }
            else:
                status = 404
                payload = {}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


class ProductionLifecycleTests(unittest.TestCase):
    def probe_server(self, server: ThreadingHTTPServer, **kwargs):
        try:
            host, port = server.server_address
            return MODULE.probe_readiness(f"http://{host}:{port}", **kwargs)
        finally:
            server.shutdown()
            server.server_close()

    def test_health_and_readiness_contract_passes(self):
        server, _ = readiness_server()
        result = self.probe_server(server)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["readiness_http_status"], 200)

    def test_readiness_503_is_a_hard_failure(self):
        server, _ = readiness_server(503)
        result = self.probe_server(server)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["reason"], "readiness_check_failed")
        self.assertEqual(result["http_status"], 503)

    def test_auth_redirect_is_not_followed_or_accepted(self):
        server, _ = readiness_server(redirect_readiness=True)
        result = self.probe_server(server)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["http_status"], 302)

    def test_runtime_origin_rejects_embedded_credentials_without_echoing_them(self):
        secret = "NO-REPORT-THIS-CREDENTIAL"
        origin = "https://" + "synthetic-user" + ":" + secret + "@backend.invalid"
        result = MODULE.probe_readiness(origin)
        self.assertEqual(result, {"status": "FAIL", "reason": "invalid_runtime_origin"})
        self.assertNotIn(secret, json.dumps(result))

    def test_local_readiness_environment_does_not_inherit_operator_secrets(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"SYSGRID_TEST_SENTINEL_SECRET": "NO-REPORT-THIS-CREDENTIAL"}
        ):
            configured = MODULE._synthetic_service_env(Path(temporary) / "service-data", 8123, MODULE.BACKEND)
        self.assertNotIn("SYSGRID_TEST_SENTINEL_SECRET", configured)
        self.assertEqual(configured["ENVIRONMENT"], "production")
        self.assertEqual(configured["AUTO_MIGRATE_ON_STARTUP"], "false")


if __name__ == "__main__":
    unittest.main()
