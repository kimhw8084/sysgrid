from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "corporate_publishability_guard.py"
SPEC = importlib.util.spec_from_file_location("corporate_publishability_guard", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
Guard = MODULE.Guard


class CorporatePublishabilityGuardTests(unittest.TestCase):
    def make_tree(self) -> Path:
        root = Path(tempfile.mkdtemp())
        files = {
            "backend/requirements.txt": "fastapi\nuvicorn\n",
            "backend/requirements.lock": (
                "fastapi==1.0 \\\n    --hash=sha256:aaaa\n"
                "uvicorn==1.0 \\\n    --hash=sha256:bbbb\n"
            ),
            "backend/app/main.py": (
                "from fastapi import FastAPI\n"
                "app = FastAPI()\n"
                "@app.get('/api/v1/health')\n"
                "def health(): return {}\n"
                "@app.get('/api/v1/readiness')\n"
                "def readiness(): return {}\n"
                "status_code=200 if ready else 503\n"
                "settings.startup_schema_management_enabled\n"
            ),
            "backend/app/core/config.py": "\n".join(
                [
                    "PORT: int = 8000",
                    "ENVIRONMENT: str = 'development'",
                    "BACKEND_CORS_ORIGINS: str = '*'",
                    "ALLOWED_HOSTS: str = 'localhost'",
                    "IDENTITY_MODE: str = 'development'",
                    "TRUSTED_PROXY_USER_HEADER: str = 'X-Authenticated-User'",
                    "DATABASE_URL: str = ''",
                    "CONFIG_DATABASE_URL: str = ''",
                    "TENANT_STORAGE_ROOT: str = ''",
                    "PRODUCTION_REQUIRED_ENV = (",
                    "'ENVIRONMENT', 'BACKEND_CORS_ORIGINS', 'ALLOWED_HOSTS', 'IDENTITY_MODE',",
                    "'TRUSTED_PROXY_USER_HEADER', 'DATABASE_URL', 'CONFIG_DATABASE_URL',",
                    "'TENANT_STORAGE_ROOT', 'PUBLIC_READONLY_ENABLED',",
                    "'ALLOW_PUBLIC_READONLY_IN_PRODUCTION', 'DEFAULT_USER_ID', 'AUTO_ADMIN_USER_IDS',",
                    "'ALLOW_AUTO_ADMIN_IN_PRODUCTION', 'CONTROL_PLANE_ADMIN_USER_IDS',",
                    "'CONTROL_PLANE_BOOTSTRAP_ENABLED', 'CONTROL_PLANE_BOOTSTRAP_USER_ID',",
                    "'SYSTEM_ROOT_USER_IDS', 'SCHEDULE_PREVIEW_SIGNING_KEY',",
                    "'PV1_RELEASE_CANDIDATE_SHA', 'PV1_RELEASE_ID', 'AUTO_MIGRATE_ON_STARTUP',",
                    "'ALLOW_AUTO_MIGRATE_IN_PRODUCTION',",
                    ")",
                ]
            ),
            "frontend/package.json": json.dumps(
                {
                    "private": True,
                    "scripts": {"build": "vite build"},
                    "engines": {"node": ">=20"},
                }
            ),
            "frontend/package-lock.json": json.dumps({
                "lockfileVersion": 3,
                "packages": {"": {"dependencies": {}, "devDependencies": {}}},
            }),
            "frontend/src/api/apiClient.ts": (
                "const a='VITE_API_BASE_URL'; const b='VITE_IDENTITY_MODE'; "
                "const c='trusted_proxy'; const d='shouldAttachUserIdHeader'; "
                "fetch('/', { credentials: 'include' });"
            ),
            "frontend/src/main.tsx": (
                "const a='VITE_API_BASE_URL'; const b='/api/v1/settings/bootstrap'; "
                "const c='Cross-origin deployment detected';"
            ),
            "deploy/backend.env.production.example": "\n".join([
                "ENVIRONMENT=production",
                "BACKEND_CORS_ORIGINS=https://frontend.invalid",
                "ALLOWED_HOSTS=backend.invalid",
                "IDENTITY_MODE=trusted_proxy",
                "TRUSTED_PROXY_USER_HEADER=X-Authenticated-User",
                "DATABASE_URL=sqlite+aiosqlite:////operator-supplied/default.db",
                "CONFIG_DATABASE_URL=sqlite+aiosqlite:////operator-supplied/config.db",
                "TENANT_STORAGE_ROOT=/operator-supplied/tenants",
                "PUBLIC_READONLY_ENABLED=false",
                "ALLOW_PUBLIC_READONLY_IN_PRODUCTION=false",
                "DEFAULT_USER_ID=replace-with-service-principal",
                "AUTO_ADMIN_USER_IDS=",
                "ALLOW_AUTO_ADMIN_IN_PRODUCTION=false",
                "CONTROL_PLANE_ADMIN_USER_IDS=replace-with-approved-admin",
                "CONTROL_PLANE_BOOTSTRAP_ENABLED=false",
                "CONTROL_PLANE_BOOTSTRAP_USER_ID=",
                "SYSTEM_ROOT_USER_IDS=replace-with-approved-root",
                "SCHEDULE_PREVIEW_SIGNING_KEY=inject-from-secret-manager",
                "PV1_RELEASE_CANDIDATE_SHA=replace-with-candidate-sha",
                "PV1_RELEASE_ID=replace-with-release-id",
                "AUTO_MIGRATE_ON_STARTUP=false",
                "ALLOW_AUTO_MIGRATE_IN_PRODUCTION=false",
            ]),
            "deploy/frontend.env.production.example": (
                "VITE_API_BASE_URL=https://replace-with-backend.invalid\nVITE_IDENTITY_MODE=trusted_proxy\n"
            ),
            "DEPLOYMENT.md": (
                "Corporate Cloud Primary Publish Path\nFastAPI project\nNode/React project\n"
                "Docker and Compose are optional\npython -m uvicorn app.main:app\n"
                "npm ci\nfrontend/dist/\nVITE_API_BASE_URL\n/api/v1/readiness\n"
                "503\noperator-managed\nrollback\n"
            ),
        }
        for relative, content in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        return root

    def statuses(self, root: Path) -> dict[str, str]:
        return {result.name: result.status for result in Guard(root).run()}

    def test_valid_dual_project_fixture_passes(self) -> None:
        statuses = self.statuses(self.make_tree())
        self.assertNotIn("FAIL", statuses.values())
        self.assertEqual(statuses["project-boundaries"], "PASS")
        self.assertEqual(statuses["frontend-separate-service-url-contract"], "PASS")

    def test_missing_frontend_lockfile_fails(self) -> None:
        root = self.make_tree()
        (root / "frontend/package-lock.json").unlink()
        statuses = self.statuses(root)
        self.assertEqual(statuses["file:frontend/package-lock.json"], "FAIL")

    def test_frontend_script_cannot_launch_backend(self) -> None:
        root = self.make_tree()
        package_path = root / "frontend/package.json"
        package = json.loads(package_path.read_text(encoding="utf-8"))
        package["scripts"]["start"] = "cd ../backend && uvicorn app.main:app"
        package_path.write_text(json.dumps(package), encoding="utf-8")
        statuses = self.statuses(root)
        self.assertEqual(statuses["frontend-project-independence"], "FAIL")

    def test_missing_separate_api_url_contract_fails(self) -> None:
        root = self.make_tree()
        (root / "frontend/src/api/apiClient.ts").write_text(
            "fetch('/', { credentials: 'include' })", encoding="utf-8"
        )
        statuses = self.statuses(root)
        self.assertEqual(statuses["frontend-separate-service-url-contract"], "FAIL")

    def test_env_output_never_contains_values(self) -> None:
        root = self.make_tree()
        secret = "DO-NOT-PRINT-THIS-VALUE"
        env_path = root / "deploy/backend.env.production.example"
        env_path.write_text(env_path.read_text(encoding="utf-8") + f"\nPASSWORD={secret}\n", encoding="utf-8")
        results = Guard(root).run()
        rendered = MODULE.render_text(results, root)
        self.assertNotIn(secret, rendered)

    def test_missing_settings_owned_production_key_fails(self) -> None:
        root = self.make_tree()
        env_path = root / "deploy/backend.env.production.example"
        env_path.write_text("\n".join(
            line for line in env_path.read_text(encoding="utf-8").splitlines()
            if not line.startswith("SYSTEM_ROOT_USER_IDS=")
        ), encoding="utf-8")
        statuses = self.statuses(root)
        self.assertEqual(statuses["backend-env-example"], "FAIL")

    def test_example_must_not_contain_usable_sensitive_values(self) -> None:
        root = self.make_tree()
        env_path = root / "deploy/backend.env.production.example"
        text = env_path.read_text(encoding="utf-8").replace(
            "SCHEDULE_PREVIEW_SIGNING_KEY=inject-from-secret-manager",
            "SCHEDULE_PREVIEW_SIGNING_KEY=usable-but-not-real-secret-value",
        )
        env_path.write_text(text, encoding="utf-8")
        statuses = self.statuses(root)
        self.assertEqual(statuses["backend-env-example-safety"], "FAIL")

    def test_browser_code_must_not_set_trusted_proxy_identity_header(self) -> None:
        root = self.make_tree()
        (root / "frontend/src/api/apiClient.ts").write_text(
            "headers.set('x-authenticated-user', userId)", encoding="utf-8"
        )
        statuses = self.statuses(root)
        self.assertEqual(statuses["browser-proxy-identity-boundary"], "FAIL")

    def test_backend_lock_must_cover_and_hash_direct_dependencies(self) -> None:
        root = self.make_tree()
        (root / "backend/requirements.txt").write_text("fastapi\nuvicorn\nhttpx\n", encoding="utf-8")
        statuses = self.statuses(root)
        self.assertEqual(statuses["backend-lock-contract"], "FAIL")

    def test_backend_lock_without_hashes_fails(self) -> None:
        root = self.make_tree()
        (root / "backend/requirements.lock").write_text("fastapi==1.0\nuvicorn==1.0\n", encoding="utf-8")
        statuses = self.statuses(root)
        self.assertEqual(statuses["backend-lock-contract"], "FAIL")


if __name__ == "__main__":
    unittest.main()
