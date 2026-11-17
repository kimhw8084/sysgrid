#!/usr/bin/env python3
"""Rack API contract check dispatched through Golden G2.

The production path generates OpenAPI from the copied SysGrid FastAPI app with
an explicit synthetic configuration, then passes that document and its full
source binding to Golden. No hand-authored server_route is supplied. OpenAPI
generation imports the actual app without lifespan or database access. A
separate disposable in-process ASGI probe exercises the endpoint against
synthetic SQLite state; no listener or network request is used. Synthetic
evaluator fixtures are labelled as such and never count as live API evidence.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend/src/components/Racks.tsx"
FETCHER = ROOT / "frontend/src/components/racksDataState.tsx"
ARRAY_FETCHER = ROOT / "frontend/src/components/shared/operationalArrayFetch.ts"
API_CLIENT = ROOT / "frontend/src/api/apiClient.ts"
BACKEND = ROOT / "backend/app/api"
MAIN = ROOT / "backend/app/main.py"
CONFIG = ROOT / "backend/app/core/config.py"
DB = ROOT / "backend/app/database.py"
IDENTITY = ROOT / "backend/app/api/utils.py"
REQUIREMENTS = ROOT / "backend/requirements.lock"
PYTHON_README = ROOT / "README.md"
MONITORING_CONTRACT = ROOT / "contracts/monitoring_domain_contract_v1.json"
PROFILE = ROOT / ".golden-uiux/everyday_project_profile.json"
BACKEND_TEST = ROOT / "backend/tests/test_rack_openapi_contract.py"
FIXTURE = ROOT / "frontend/tests/rack-search-selection.visual.fixture.spec.ts"
PACKAGE = ROOT / "frontend/package.json"
CHECKER = Path(__file__).resolve()
GOLDEN_ROOT = ROOT / ".golden-uiux"
SOURCE_SNAPSHOT = "26287becbe5c9f0457bd5ab46a6fe1bc2067a945f9eb89ed39fc5e74363359b7"
EXPECTED_HEAD = "36a34cb659bf5fc05ec518d9b1910daeb79748cb"
API_ORIGIN = "http://127.0.0.1:8000"  # bound synthetic evidence origin; the ASGI probe opens no socket
SYNTHETIC_IDENTITY = {"user_id": "sysgrid.qualifier", "tenant_id": 1}
RACK_NULLABLE_ITEM_FIELDS = {
    "name", "aisle", "row", "total_u", "pdu_a_name", "pdu_b_name", "pdu_a_cap_kw",
    "pdu_b_cap_kw", "room_id", "site_id", "site_name", "site_color", "order_index", "is_deleted",
}
CONTRACT = {
    "origin": API_ORIGIN,
    "method": "GET",
    "path": "/api/v1/racks",
    "query": {"include_deleted": "true"},
    "identity_scope": ["tenant_id", "user_id"],
    "identity_scope_extension": "x-sysgrid-identity-scope",
    "expected_statuses": [200, 401, 403, 404, 422],
    "response_schema": {
        "kind": "array", "items_kind": "object",
        "item_required_fields": [
            "id", "name", "aisle", "row", "total_u", "max_power_kw", "pdu_a_name", "pdu_b_name",
            "pdu_a_cap_kw", "pdu_b_cap_kw", "room_id", "site_id", "site_name", "site_color",
            "order_index", "is_deleted", "device_locations",
        ],
        "item_field_types": {
            "id": "integer", "name": "string", "aisle": "string", "row": "string", "total_u": "integer",
            "max_power_kw": "number", "pdu_a_name": "string", "pdu_b_name": "string",
            "pdu_a_cap_kw": "number", "pdu_b_cap_kw": "number", "room_id": "integer", "site_id": "integer",
            "site_name": "string", "site_color": "string", "order_index": "integer", "is_deleted": "boolean",
            "device_locations": "array",
        },
        "item_field_nullability": {name: True for name in sorted(RACK_NULLABLE_ITEM_FIELDS)},
    },
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def literal_string(node: ast.AST) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def backend_routes(module: str) -> tuple[str, dict[str, set[str]]]:
    path = BACKEND / f"{module}.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    prefix = None
    routes: dict[str, set[str]] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "router" for t in node.targets):
            call = node.value
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "APIRouter":
                for kw in call.keywords:
                    if kw.arg == "prefix":
                        prefix = literal_string(kw.value)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            owner = decorator.func.value
            if not isinstance(owner, ast.Name) or owner.id != "router":
                continue
            method = decorator.func.attr.upper()
            if not decorator.args:
                raise AssertionError(f"{path}:{node.lineno} route path is not explicit")
            suffix = literal_string(decorator.args[0])
            if suffix is None:
                raise AssertionError(f"{path}:{node.lineno} route path must be a string literal")
            routes.setdefault(method, set()).add(suffix)
    if prefix is None:
        raise AssertionError(f"Could not derive APIRouter prefix from {path}")
    return prefix, routes


def derive_api_prefix() -> str:
    tree = ast.parse(CONFIG.read_text(encoding="utf-8"), filename=str(CONFIG))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        if any(isinstance(t, ast.Name) and t.id == "API_V1_STR" for t in targets):
            value = literal_string(node.value)
            if value:
                return value.rstrip("/")
    raise AssertionError("Could not derive API_V1_STR from backend configuration")


def redirects_disabled() -> bool:
    tree = ast.parse(MAIN.read_text(encoding="utf-8"), filename=str(MAIN))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == "app" for t in node.targets):
            continue
        call = node.value
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "FastAPI":
            return any(kw.arg == "redirect_slashes" and isinstance(kw.value, ast.Constant) and kw.value.value is False for kw in call.keywords)
    raise AssertionError("Could not verify FastAPI redirect_slashes setting")


def verify_route_mounts(modules: set[str]) -> None:
    tree = ast.parse(MAIN.read_text(encoding="utf-8"), filename=str(MAIN))
    for node in ast.walk(tree):
        if not isinstance(node, ast.For) or not isinstance(node.target, ast.Name) or node.target.id != "router":
            continue
        if not isinstance(node.iter, (ast.Tuple, ast.List)):
            continue
        mounted = {
            item.value.id for item in node.iter.elts
            if isinstance(item, ast.Attribute) and item.attr == "router" and isinstance(item.value, ast.Name)
        }
        has_v1_mount = any(
            isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
            and isinstance(call.func.value, ast.Name) and call.func.value.id == "app"
            and call.func.attr == "include_router" and call.args
            and isinstance(call.args[0], ast.Name) and call.args[0].id == "router"
            and any(keyword.arg == "prefix" and isinstance(keyword.value, ast.Attribute)
                    and keyword.value.attr == "API_V1_STR"
                    and isinstance(keyword.value.value, ast.Name) and keyword.value.value.id == "settings"
                    for keyword in call.keywords)
            for statement in node.body for call in ast.walk(statement)
        )
        if modules.issubset(mounted) and has_v1_mount:
            return
    raise AssertionError(f"Backend routers {sorted(modules)} are not mounted under settings.API_V1_STR")


def verify_g2_wiring() -> None:
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    scripts = package.get("scripts", {})
    if scripts.get("check:golden-g2-rack-api") != "python3 scripts/check_rack_api_contract.py":
        raise AssertionError("Golden Rack API contract checker is not registered as an executable frontend script")
    operational = scripts.get("check:operational-contracts", "")
    if "npm run check:golden-g2-rack-api" not in operational.split(" && "):
        raise AssertionError("The normal operational-contract path does not invoke Golden G2 Rack API verification")


def frontend_routes(source: str):
    fetch_calls = re.findall(r"fetchRackArray\(\s*(['\"])([^'\"]+)\1\s*\)", source)
    api_calls = []
    pattern = re.compile(r"apiFetch\(\s*(['\"])([^'\"]+)\1\s*,\s*\{(.*?)\}\s*\)", re.S)
    for match in pattern.finditer(source):
        method_match = re.search(r"method\s*:\s*(['\"])([A-Z]+)\1", match.group(3))
        if method_match:
            api_calls.append((method_match.group(2), match.group(2)))
    return [url for _, url in fetch_calls], api_calls


def route_descriptor(origin: str, method: str, path: str, query: dict, identity_scope: list[str]):
    return {"origin": origin, "method": method, "path": path, "query": query, "identity_scope": identity_scope}


def backend_source_paths() -> list[Path]:
    paths = sorted((ROOT / "backend/app").rglob("*.py"))
    paths += [REQUIREMENTS, MONITORING_CONTRACT, BACKEND_TEST]
    return sorted(set(paths), key=lambda p: p.relative_to(ROOT).as_posix())


def source_bindings() -> dict[str, str]:
    paths = backend_source_paths() + [
        MAIN, CONFIG, DB, IDENTITY, FRONTEND, FETCHER, ARRAY_FETCHER, API_CLIENT,
        FIXTURE, PROFILE, PACKAGE, CHECKER,
        GOLDEN_ROOT / "golden_uiux/backend_contracts.py",
        GOLDEN_ROOT / "golden_uiux/data_api_gates.py",
        GOLDEN_ROOT / "golden_uiux/gate_pipeline.py",
    ]
    result = {}
    for path in sorted(set(paths), key=lambda p: p.relative_to(ROOT).as_posix()):
        if path.is_symlink() or not path.is_file():
            raise AssertionError(f"Source-bound G2 input is missing or unsafe: {path.relative_to(ROOT)}")
        result[path.relative_to(ROOT).as_posix()] = sha(path.read_bytes())
    return result


def profile_approval_status() -> str:
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    status = profile.get("approval_status")
    if status not in {"PROPOSED", "APPROVED", "REVOKED", "EXPIRED", "UNKNOWN"}:
        raise AssertionError(f"Invalid source-bound project profile approval status: {status!r}")
    return status


def choose_backend_python(requested: Path | None = None) -> Path:
    requested_value = str(requested) if requested is not None else os.environ.get("SYSGRID_BACKEND_PYTHON")
    candidates = [Path(requested_value)] if requested_value else []
    candidates.extend([ROOT / "backend/venv/bin/python", ROOT / "backend/.venv/bin/python", Path(sys.executable)])
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            # Preserve a venv's bin/python symlink. Path.resolve() follows it to
            # the base interpreter and silently drops the pinned site-packages.
            return candidate.absolute()
    raise RuntimeError("No executable backend Python is available; set SYSGRID_BACKEND_PYTHON to an authorized backend venv")


def run_synthetic_asgi_probe(backend_python: Path) -> dict:
    """Exercise actual Rack auth, tenant lookup, route and body via in-process ASGI."""
    with tempfile.TemporaryDirectory(prefix="sysgrid-g2-asgi-", dir="/private/tmp") as temp:
        scratch = Path(temp)
        observation_path = scratch / "asgi-observation.json"
        if (scratch / ".env").exists():
            raise RuntimeError("ASGI probe cwd unexpectedly contains .env")
        probe_env = {"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1",
                     "PYTHONPATH": str(ROOT / "backend"),
                     "SYSGRID_RACK_CONTRACT_EVIDENCE_PATH": str(observation_path)}
        completed = subprocess.run([str(backend_python), "-B", str(BACKEND_TEST)], cwd=scratch,
                                   env=probe_env, capture_output=True, text=True, timeout=120)
        if completed.returncode:
            raise RuntimeError(f"Synthetic ASGI Rack behavior tests failed ({completed.returncode}): {completed.stderr[-2500:]} {completed.stdout[-2500:]}")
        if not observation_path.is_file():
            raise RuntimeError("Synthetic ASGI probe passed without writing its expected observation")
        observation = json.loads(observation_path.read_text(encoding="utf-8"))
        if (observation.get("schema") != "sysgrid.synthetic-asgi-observation.v1"
                or observation.get("execution") != "in-process ASGI transport; no listening service or network request"
                or observation.get("status") != 200
                or observation.get("production_accessed") is not False
                or observation.get("credentials_recorded") is not False):
            raise RuntimeError("Synthetic ASGI observation did not meet its provenance and safety contract")
        ran = re.search(r"Ran (\d+) tests?", completed.stderr)
        return {"observation": observation, "test_count": int(ran.group(1)) if ran else None,
                "stdout": completed.stdout, "stderr": completed.stderr}


def lock_versions() -> dict[str, str]:
    text = REQUIREMENTS.read_text(encoding="utf-8")
    return {name.lower().replace("_", "-"): version for name, version in re.findall(r"^([A-Za-z0-9_.-]+)==([^\\\s]+)", text, re.M)}


def generate_backend_openapi(backend_python: Path | None = None) -> tuple[dict, dict]:
    """Import the actual copied FastAPI app with isolated synthetic config, no lifespan or request."""
    bindings_before = source_bindings()
    python = choose_backend_python(backend_python)
    with tempfile.TemporaryDirectory(prefix="sysgrid-g2-openapi-", dir="/private/tmp") as temp:
        scratch = Path(temp)
        storage = scratch / "tenant-storage"
        storage.mkdir()
        if (scratch / ".env").exists():
            raise RuntimeError("OpenAPI generation cwd unexpectedly contains .env")
        synthetic_env = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(ROOT / "backend"),
            "ENVIRONMENT": "test",
            "TESTING": "1",
            "IDENTITY_MODE": "trusted_proxy",
            "TRUSTED_PROXY_USER_HEADER": "X-Authenticated-User",
            "DATABASE_URL": "sqlite+aiosqlite:///" + str(scratch / "synthetic-tenant.db"),
            "CONFIG_DATABASE_URL": "sqlite+aiosqlite:///" + str(scratch / "synthetic-config.db"),
            "TENANT_STORAGE_ROOT": str(storage),
            "DEFAULT_USER_ID": SYNTHETIC_IDENTITY["user_id"],
            "USER_ID": SYNTHETIC_IDENTITY["user_id"],
            "DEFAULT_TENANT_NAME": "Golden G2 Synthetic",
            "AUTO_ADMIN_USER_IDS": "",
            "CONTROL_PLANE_ADMIN_USER_IDS": "",
            "SYSTEM_ROOT_USER_IDS": "",
            "BACKEND_ENV_FILE_PATH": "",
            "FRONTEND_ENV_FILE_PATH": "",
            "ALLOWED_HOSTS": "localhost,127.0.0.1,testserver",
            "BACKEND_CORS_ORIGINS": "*",
            "SYSGRID_EXPECTED_MAIN": str(MAIN.resolve()),
        }
        child_code = r'''import importlib.metadata, json, os, sys
from pathlib import Path
import app.main as main
expected = Path(os.environ["SYSGRID_EXPECTED_MAIN"]).resolve()
actual = Path(main.__file__).resolve()
if actual != expected: raise RuntimeError(f"backend import escaped isolated source: {actual}")
versions = {}
for name in ("fastapi", "pydantic-settings", "sqlalchemy", "alembic", "aiosqlite"):
    try: versions[name] = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError: versions[name] = None
print(json.dumps({"openapi_document": main.app.openapi(), "main_source": str(actual),
                  "python_version": ".".join(map(str, sys.version_info[:3])), "package_versions": versions},
                 sort_keys=True, separators=(",", ":")))'''
        completed = subprocess.run([str(python), "-B", "-c", child_code], cwd=scratch,
                                   env=synthetic_env, capture_output=True, text=True, timeout=90)
        if completed.returncode:
            raise RuntimeError(f"backend OpenAPI import failed ({completed.returncode}): {completed.stderr[-2500:]}")
        generated = json.loads(completed.stdout)
        document = generated.get("openapi_document")
        if not isinstance(document, dict) or not str(document.get("openapi", "")).startswith("3."):
            raise RuntimeError("actual app.openapi() returned no OpenAPI 3 document")
        if generated.get("main_source") != str(MAIN.resolve()):
            raise RuntimeError("OpenAPI was not emitted by the inspected isolated backend/app/main.py")
        db_files_created = [name for name in ("synthetic-tenant.db", "synthetic-config.db") if (scratch / name).exists()]
        if db_files_created:
            raise RuntimeError(f"OpenAPI-only import unexpectedly created database files: {db_files_created}")
        if (scratch / ".env").exists():
            raise RuntimeError("OpenAPI-only import cwd unexpectedly contains .env")
    bindings_after = source_bindings()
    if bindings_after != bindings_before:
        raise RuntimeError("Backend or wrapper source changed during OpenAPI generation")
    pinned = lock_versions()
    installed = generated["package_versions"]
    lock_check = {name: {"locked": pinned.get(name), "installed": installed.get(name), "match": pinned.get(name) == installed.get(name)}
                  for name in ("fastapi", "pydantic-settings", "sqlalchemy", "alembic", "aiosqlite")}
    python_required = "3.12+" if "Python 3.12+" in PYTHON_README.read_text(encoding="utf-8") else "UNSPECIFIED"
    python_ok = tuple(int(x) for x in generated["python_version"].split(".")) >= (3, 12)
    document_sha = sha(canonical_json(document))
    provenance = {
        "schema": "sysgrid.backend-openapi-provenance.v1",
        "generated_by": "backend.app.main:app.openapi()",
        "main_source": generated["main_source"],
        "main_source_sha256": bindings_after[MAIN.relative_to(ROOT).as_posix()],
        "source_snapshot_sha256": SOURCE_SNAPSHOT,
        "backend_source_bindings": {k: v for k, v in bindings_after.items() if k.startswith("backend/") or k == MONITORING_CONTRACT.relative_to(ROOT).as_posix()},
        "source_bindings": bindings_after,
        "source_bindings_sha256": sha(canonical_json(bindings_after)),
        "openapi_document_sha256": document_sha,
        "openapi_version": document.get("openapi"),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "runtime": {"python": generated["python_version"], "python_minimum_from_readme": python_required,
                    "python_supported": python_ok, "packages": installed, "locked_package_checks": lock_check,
                    "lock_dependencies_match": all(item["match"] for item in lock_check.values())},
        "execution": {"synthetic_identity": SYNTHETIC_IDENTITY, "environment": "test",
                      "identity_mode": "trusted_proxy", "trusted_proxy_user_header": "X-Authenticated-User",
                      "cwd_had_dotenv": False,
                      "database_urls": "unique disposable SQLite paths under temporary scratch", "database_files_created": False,
                      "app_lifespan_started": False, "database_connections_opened": False,
                      "HTTP_requests_sent": False, "production_resources_accessed": False},
    }
    return document, provenance


def validate_openapi_binding(document: object, provenance: object, current: dict[str, str] | None = None,
                             *, allow_synthetic_fixture: bool = False) -> list[str]:
    issues = []
    if not isinstance(document, dict) or not str(document.get("openapi", "")).startswith("3."):
        return ["missing or invalid backend-generated OpenAPI 3 document"]
    if not isinstance(provenance, dict):
        return ["missing OpenAPI provenance record"]
    actual_origin = provenance.get("generated_by") == "backend.app.main:app.openapi()"
    synthetic_origin = (allow_synthetic_fixture and provenance.get("schema") == "synthetic-g2-evaluator-fixture.v1"
                        and provenance.get("generated_by") == "self-test-only")
    if not (actual_origin or synthetic_origin):
        issues.append("OpenAPI origin is not the actual SysGrid FastAPI app")
    if provenance.get("source_snapshot_sha256") != SOURCE_SNAPSHOT:
        issues.append("OpenAPI source snapshot is stale or mismatched")
    if provenance.get("openapi_document_sha256") != sha(canonical_json(document)):
        issues.append("OpenAPI bytes are stale or differ from the generated document")
    bindings = provenance.get("source_bindings")
    if not isinstance(bindings, dict) or provenance.get("source_bindings_sha256") != sha(canonical_json(bindings)):
        issues.append("OpenAPI source-binding manifest is missing or has an invalid digest")
    if current is not None and provenance.get("source_bindings_sha256") != sha(canonical_json(current)):
        issues.append("OpenAPI source bindings are stale relative to the current isolated copy")
    if provenance.get("main_source") != str(MAIN.resolve()):
        issues.append("OpenAPI generator imported a different backend main module")
    return issues


def _schema_has_type(schema: object, expected_type: str, *, nullable: bool = False) -> bool:
    if not isinstance(schema, dict):
        return False
    if schema.get("type") == expected_type:
        return schema.get("nullable", False) is nullable
    branches = schema.get("anyOf")
    if nullable and isinstance(branches, list):
        kinds = {item.get("type") for item in branches if isinstance(item, dict)}
        return kinds == {expected_type, "null"} and len(branches) == 2
    return False


def _resolve_local_schema(document: dict, schema: object) -> dict | None:
    """Resolve source-generated local component references without network access."""
    if not isinstance(schema, dict):
        return None
    reference = schema.get("$ref")
    if reference is None:
        return schema
    prefix = "#/components/schemas/"
    if not isinstance(reference, str) or not reference.startswith(prefix):
        return None
    name = reference[len(prefix):].replace("~1", "/").replace("~0", "~")
    components = document.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    target = schemas.get(name) if isinstance(schemas, dict) else None
    return target if isinstance(target, dict) else None


def _schema_has_json_type(document: dict, raw_schema: object, expected_type: str, *, nullable: bool = False) -> bool:
    schema = _resolve_local_schema(document, raw_schema)
    if not isinstance(schema, dict):
        return False
    if schema.get("type") == expected_type:
        return not nullable or schema.get("nullable") is True
    branches = schema.get("anyOf")
    if nullable and isinstance(branches, list) and len(branches) == 2:
        kinds = {branch.get("type") for branch in branches if isinstance(branch, dict)}
        return kinds == {expected_type, "null"}
    return False


def _validate_object_properties(document: dict, raw_schema: object, *, required_fields: list[str],
                               field_types: dict[str, tuple[str, bool]], label: str) -> list[str]:
    schema = _resolve_local_schema(document, raw_schema)
    if not isinstance(schema, dict) or schema.get("type") != "object":
        return [f"{label} is not an object schema"]
    required = schema.get("required")
    properties = schema.get("properties")
    if not isinstance(required, list) or not isinstance(properties, dict):
        return [f"{label} lacks required fields or property schemas"]
    issues = []
    if not set(required_fields).issubset(required):
        issues.append(f"{label} omits required properties: {sorted(set(required_fields) - set(required))}")
    for name, (kind, nullable) in field_types.items():
        if not _schema_has_json_type(document, properties.get(name), kind, nullable=nullable):
            issues.append(f"{label}.{name} is not accurately declared as {kind}{' or null' if nullable else ''}")
    return issues


def validate_rack_openapi_declarations(document: object) -> list[str]:
    """Check route-specific declarations the generic Golden parser does not validate."""
    if not isinstance(document, dict):
        return ["OpenAPI document is missing"]
    paths = document.get("paths")
    path_item = paths.get("/api/v1/racks") if isinstance(paths, dict) else None
    operation = path_item.get("get") if isinstance(path_item, dict) else None
    if not isinstance(operation, dict):
        return ["GET /api/v1/racks is absent from generated OpenAPI"]
    issues: list[str] = []
    schemes = (document.get("components") or {}).get("securitySchemes")
    expected_scheme = "SysGridTrustedProxyIdentity"
    expected_security = {expected_scheme: []}
    if not isinstance(schemes, dict):
        issues.append("OpenAPI securitySchemes are missing")
    else:
        scheme = schemes.get(expected_scheme)
        if (not isinstance(scheme, dict) or scheme.get("type") != "apiKey" or scheme.get("in") != "header"
                or scheme.get("name") != "X-Authenticated-User"
                or "trusted proxy" not in str(scheme.get("description", "")).lower()):
            issues.append("trusted-proxy security scheme differs from the actual configured identity header")
    if expected_security not in (operation.get("security") or []):
        issues.append("Rack GET does not require the declared trusted-proxy identity scheme")
    if operation.get("x-sysgrid-identity-scope") != ["tenant_id", "user_id"]:
        issues.append("Rack identity-scope extension does not bind both user and tenant")
    parameters = [item for item in operation.get("parameters", []) if isinstance(item, dict)]
    expected_params = {
        ("query", "site_id"): ("string", False, True),
        ("query", "include_deleted"): ("boolean", False, False),
        ("header", "X-Tenant-Id"): ("string", False, True),
    }
    for key, (kind, required, nullable) in expected_params.items():
        parameter = next((p for p in parameters if (p.get("in"), p.get("name")) == key), None)
        schema = parameter.get("schema") if isinstance(parameter, dict) else None
        if (not isinstance(parameter, dict) or parameter.get("required", False) is not required
                or not _schema_has_type(schema, kind, nullable=nullable)):
            issues.append(f"Rack parameter {key[1]} does not match its source declaration")
    include_deleted = next((p for p in parameters if (p.get("in"), p.get("name")) == ("query", "include_deleted")), None)
    if isinstance(include_deleted, dict) and include_deleted.get("schema", {}).get("default") is not False:
        issues.append("include_deleted default differs from the backend route")
    responses = operation.get("responses")
    if not isinstance(responses, dict):
        issues.append("Rack responses are missing")
    else:
        for status_code in ("200", "401", "403", "404", "422"):
            if status_code not in responses:
                issues.append(f"Rack response status {status_code} is undocumented")
            elif status_code != "200":
                response = responses[status_code]
                content = response.get("content") if isinstance(response, dict) else None
                media = content.get("application/json") if isinstance(content, dict) else None
                if not isinstance(media, dict) or not isinstance(media.get("schema"), dict):
                    issues.append(f"Rack response status {status_code} lacks its documented JSON error schema")
        success = responses.get("200", {})
        schema = (((success.get("content") or {}).get("application/json") or {}).get("schema")) if isinstance(success, dict) else None
        if not isinstance(schema, dict):
            issues.append("Rack success response has no JSON schema")
        else:
            resolved_array = _resolve_local_schema(document, schema)
            if not isinstance(resolved_array, dict) or resolved_array.get("type") != "array":
                issues.append("Rack success response is not a typed array")
            else:
                item = resolved_array.get("items")
                item_types = {name: (kind, name in RACK_NULLABLE_ITEM_FIELDS)
                              for name, kind in CONTRACT["response_schema"]["item_field_types"].items()
                              if name != "device_locations"}
                issues.extend(_validate_object_properties(
                    document, item,
                    required_fields=CONTRACT["response_schema"]["item_required_fields"],
                    field_types=item_types, label="Rack response item"))
                resolved_item = _resolve_local_schema(document, item)
                item_properties = resolved_item.get("properties", {}) if isinstance(resolved_item, dict) else {}
                locations_array = _resolve_local_schema(document, item_properties.get("device_locations"))
                if not isinstance(locations_array, dict) or locations_array.get("type") != "array":
                    issues.append("Rack response item.device_locations is not an array")
                else:
                    location_types = {"id": ("integer", False), "device_id": ("integer", False),
                                      "rack_id": ("integer", False), "start_unit": ("integer", True),
                                      "size_u": ("integer", True), "orientation": ("string", False),
                                      "depth": ("string", False)}
                    issues.extend(_validate_object_properties(
                        document, locations_array.get("items"),
                        required_fields=[*location_types, "device"], field_types=location_types,
                        label="Rack response device location"))
                    loc_item = _resolve_local_schema(document, locations_array.get("items"))
                    loc_props = loc_item.get("properties", {}) if isinstance(loc_item, dict) else {}
                    device_types = {"id": ("integer", False), "name": ("string", True),
                                    "status": ("string", True), "type": ("string", True),
                                    "system": ("string", True), "owner": ("string", True),
                                    "power_typical_w": ("number", False), "power_max_w": ("number", False),
                                    "is_reservation": ("boolean", False), "reservation_info": ("object", False),
                                    "depth": ("string", False)}
                    issues.extend(_validate_object_properties(
                        document, loc_props.get("device"), required_fields=list(device_types),
                        field_types=device_types, label="Rack response mounted device"))
    return issues


def evaluate_g2(case_name: str, *, contract: dict, client_route: dict, openapi_document: dict,
                observed: dict | None, expected_identity: dict, source_bindings: dict,
                openapi_provenance: dict | None = None) -> dict:
    """Exercise the exact Golden G2 dispatcher using an OpenAPI document, never server_route."""
    sys.path.insert(0, str(GOLDEN_ROOT))
    from golden_uiux.core import catalog_digest
    from golden_uiux.gate_pipeline import checker_digest
    with tempfile.TemporaryDirectory(prefix="golden-rack-g2-") as temporary:
        evidence_root = Path(temporary)
        input_dir = evidence_root / "g2"
        input_dir.mkdir()
        openapi_path = input_dir / "backend-openapi.json"
        openapi_bytes = json.dumps(openapi_document, sort_keys=True, indent=2, ensure_ascii=False).encode() + b"\n"
        openapi_path.write_bytes(openapi_bytes)
        provenance = openapi_provenance or {"schema": "synthetic-g2-evaluator-fixture.v1", "generated_by": "self-test-only"}
        provenance_path = input_dir / "openapi-provenance.json"
        provenance_bytes = json.dumps(provenance, sort_keys=True, indent=2, ensure_ascii=False).encode() + b"\n"
        provenance_path.write_bytes(provenance_bytes)
        source_path = input_dir / "source-bindings.json"
        source_bytes = json.dumps(source_bindings, sort_keys=True, indent=2).encode() + b"\n"
        source_path.write_bytes(source_bytes)
        api_input = {"contract": contract, "client_route": client_route,
                     "openapi_document": openapi_document, "observed": observed,
                     "expected_identity": expected_identity,
                     "openapi_provenance": provenance}
        input_bytes = json.dumps(api_input, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode() + b"\n"
        input_path = input_dir / f"{case_name}.json"
        input_path.write_bytes(input_bytes)
        artifact_pairs = [(input_path, input_bytes), (openapi_path, openapi_bytes),
                          (provenance_path, provenance_bytes), (source_path, source_bytes)]
        if observed is not None:
            observation_path = input_dir / "asgi-observation.json"
            observation_bytes = json.dumps(observed, sort_keys=True, indent=2, ensure_ascii=False).encode() + b"\n"
            artifact_pairs.append((observation_path, observation_bytes))
        artifacts = []
        for path, data in artifact_pairs:
            path.write_bytes(data)
            artifacts.append({"path": path.relative_to(evidence_root).as_posix(), "sha256": sha(data)})
        checker = checker_digest(GOLDEN_ROOT)
        catalog = catalog_digest()
        source_digest = SOURCE_SNAPSHOT
        profile_bytes = PROFILE.read_bytes()
        profile_hash = sha(profile_bytes)
        profile_status = profile_approval_status()
        environment_mode = (
            "synthetic-backend-asgi-no-network" if observed is not None and provenance.get("generated_by") == "backend.app.main:app.openapi()"
            else "synthetic-backend-openapi-import-no-request" if provenance.get("generated_by") == "backend.app.main:app.openapi()"
            else "synthetic-g2-evaluator-fixture-only"
        )
        source_binding = {
            "source_revision": {"sha256": source_digest, "verification": "frozen-application-source-snapshot"},
            "catalog": {"sha256": catalog},
            "project_profile": {"status": "BOUND", "sha256": profile_hash, "approval_status": profile_status},
            "environment": {"mode": environment_mode},
            "checker": {"sha256": checker},
        }
        request = {"schema": "golden-uiux.executable-gate-request.v1", "run_id": f"sysgrid-rack-api-{case_name}",
                   "source_binding": source_binding,
                   "gates": {"G2_API_CONTRACT": {"input_artifact": artifacts[0], "evidence": artifacts}}}
        expected = {"source_revision.sha256": source_digest, "catalog.sha256": catalog,
                    "project_profile.sha256": profile_hash, "environment.mode": environment_mode,
                    "checker.sha256": checker}
        request_path = evidence_root / "request.json"
        expected_path = evidence_root / "expected-bindings.json"
        request_path.write_text(json.dumps(request, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        expected_path.write_text(json.dumps(expected, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        command = [sys.executable, "-B", str(GOLDEN_ROOT / "uiux.py"), "evaluate-gates", str(request_path),
                   "--expected-bindings", str(expected_path), "--evidence-root", str(evidence_root)]
        clean_env = {"PATH": os.defpath, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(ROOT)}
        completed = subprocess.run(command, cwd=ROOT, env=clean_env, capture_output=True, text=True)
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise AssertionError(f"Golden G2 CLI returned no JSON for {case_name}: {completed.stderr[-1000:]}") from error
        gate = next((item for item in report.get("gate_results", []) if item.get("gate_id") == "G2_API_CONTRACT"), None)
        invocations = next((item for item in report.get("invocations", []) if item.get("gate_id") == "G2_API_CONTRACT"), None)
        if gate is None or invocations is None or "golden_uiux.backend_contracts.evaluate_backend_openapi_contract" not in invocations.get("invoked", []):
            raise AssertionError(f"Golden G2 did not invoke backend OpenAPI evaluation for {case_name}: {json.dumps(report, sort_keys=True)[:3500]}")
        if "golden_uiux.data_api_gates.evaluate_api_contract" not in invocations.get("invoked", []):
            # If backend OpenAPI is invalid the evaluator may stop before request observation. That's fail-closed.
            backend = gate.get("result", {}).get("backend_route_contract", {})
            if backend.get("status") == "PASS":
                raise AssertionError(f"Golden G2 did not invoke request-contract evaluator for {case_name}")
        return {"case": case_name, "gate_status": gate.get("status"), "invoked": invocations.get("invoked"),
                "cli_exit_code": completed.returncode, "overall_gate_status": report.get("status"),
                "profile_approval_status": profile_status, "promotion_permitted": report.get("promotion_permitted"),
                "gate_result": gate.get("result"), "gate_record": gate}


def good_openapi_fixture() -> dict:
    field_types = CONTRACT["response_schema"]["item_field_types"]
    required = CONTRACT["response_schema"]["item_required_fields"]
    properties = {
        name: ({"anyOf": [{"type": kind}, {"type": "null"}]} if name in RACK_NULLABLE_ITEM_FIELDS else {"type": kind})
        for name, kind in field_types.items() if name != "device_locations"
    }
    properties["device_locations"] = {"type": "array"}
    location_types = {"id": "integer", "device_id": "integer", "rack_id": "integer",
                      "start_unit": "integer", "size_u": "integer", "orientation": "string", "depth": "string"}
    location_properties = {
        name: ({"anyOf": [{"type": kind}, {"type": "null"}]} if name in {"start_unit", "size_u"} else {"type": kind})
        for name, kind in location_types.items()
    }
    device_types = {"id": "integer", "name": "string", "status": "string", "type": "string", "system": "string",
                    "owner": "string", "power_typical_w": "number", "power_max_w": "number",
                    "is_reservation": "boolean", "reservation_info": "object", "depth": "string"}
    device_nullable = {"name", "status", "type", "system", "owner"}
    device_properties = {
        name: ({"anyOf": [{"type": kind}, {"type": "null"}]} if name in device_nullable else {"type": kind})
        for name, kind in device_types.items()
    }
    location_properties["device"] = {"type": "object", "required": list(device_types), "properties": device_properties}
    properties["device_locations"] = {
        "type": "array",
        "items": {
            "type": "object",
            "required": [*location_types, "device"],
            "properties": location_properties,
        },
    }
    error_schema = {"type": "object", "required": ["detail"],
                    "properties": {"detail": {}, "message": {"anyOf": [{"type": "string"}, {"type": "null"}]}}}
    return {
        "openapi": "3.1.0",
        "components": {"securitySchemes": {"SysGridTrustedProxyIdentity": {
            "type": "apiKey", "in": "header", "name": "X-Authenticated-User",
            "description": "Authenticated principal asserted by the configured trusted proxy.",
        }}},
        "paths": {"/api/v1/racks": {
            "get": {
                "operationId": "get_racks_api_v1_racks_get",
                "parameters": [
                    {"name": "site_id", "in": "query", "required": False,
                     "schema": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
                    {"name": "include_deleted", "in": "query", "required": False, "schema": {"type": "boolean", "default": False}},
                    {"name": "X-Tenant-Id", "in": "header", "required": False,
                     "schema": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
                ],
                "security": [{"SysGridTrustedProxyIdentity": []}],
                "x-sysgrid-identity-scope": ["tenant_id", "user_id"],
                "responses": {
                    "200": {"description": "Tenant-scoped Rack collection", "content": {"application/json": {
                        "schema": {"type": "array", "items": {"type": "object", "required": required,
                                   "properties": properties}}
                    }}},
                    "401": {"description": "Identity missing or invalid", "content": {"application/json": {"schema": error_schema}}},
                    "403": {"description": "Tenant membership or Rack access denied", "content": {"application/json": {"schema": error_schema}}},
                    "404": {"description": "Tenant not found", "content": {"application/json": {"schema": error_schema}}},
                    "422": {"description": "Invalid query value", "content": {"application/json": {"schema": error_schema}}},
                },
            }
        }},
    }


def static_contract_check() -> dict:
    verify_g2_wiring()
    api_prefix = derive_api_prefix()
    if api_prefix != "/api/v1":
        raise AssertionError(f"This SysGrid source lock expects API_V1_STR=/api/v1, found {api_prefix!r}")
    if not redirects_disabled():
        raise AssertionError("Backend route slash behavior changed; re-review exact route semantics")
    source = FRONTEND.read_text(encoding="utf-8")
    fetch_calls, api_calls = frontend_routes(source)
    fetcher = FETCHER.read_text(encoding="utf-8")
    array_fetcher = ARRAY_FETCHER.read_text(encoding="utf-8")
    api_client = API_CLIENT.read_text(encoding="utf-8")
    if "fetchOperationalArray(endpoint, 'Rack request')" not in fetcher or "apiFetch(endpoint)" not in array_fetcher:
        raise AssertionError("Rack collection loader no longer follows the inspected operational-array fetch path")
    if not re.search(r"method\s*=\s*String\(options\.method\s*\|\|\s*'GET'\)", api_client):
        raise AssertionError("Rack collection fetch no longer defaults apiFetch to GET")
    route_modules = {name: backend_routes(name) for name in ("racks", "sites", "devices")}
    verify_route_mounts(set(route_modules))
    requirements = [
        ("GET racks", "racks", "GET", "/api/v1/racks", {"include_deleted": "true"}, fetch_calls),
        ("GET sites", "sites", "GET", "/api/v1/sites", {}, fetch_calls),
        ("GET devices", "devices", "GET", "/api/v1/devices", {}, fetch_calls),
    ]
    verified = []
    for label, module, method, expected_path, expected_query, calls in requirements:
        prefix, routes = route_modules[module]
        if "" not in routes.get(method, set()):
            raise AssertionError(f"Backend no longer declares {method} {prefix} via an empty route suffix")
        canonical = f"{api_prefix}{prefix}"
        if canonical != expected_path:
            raise AssertionError(f"Backend-derived route for {label} changed: {canonical}")
        matches = []
        for raw in calls:
            split = urlsplit(raw)
            query_pairs = parse_qsl(split.query, keep_blank_values=True)
            query = dict(query_pairs)
            if len(query_pairs) != len(query):
                raise AssertionError(f"Frontend {label} duplicates query parameters in {raw}")
            if split.path == canonical or split.path.rstrip("/") == canonical:
                matches.append((raw, split.path, query))
        if len(matches) != 1:
            raise AssertionError(f"Expected exactly one Rack-view GET for {label}, found {matches}")
        raw, path, query = matches[0]
        if path != canonical:
            raise AssertionError(f"Frontend {label} uses noncanonical path {path}; backend is {canonical}")
        if query != expected_query:
            raise AssertionError(f"Frontend {label} query is {query}, expected {expected_query}")
        verified.append({"label": label, "method": method, "canonical_path": canonical, "query": query, "source_call": raw})
    create_requirements = [("POST racks", "racks", "/api/v1/racks"), ("POST sites", "sites", "/api/v1/sites"), ("POST devices", "devices", "/api/v1/devices")]
    for label, module, expected_path in create_requirements:
        prefix, routes = route_modules[module]
        if "" not in routes.get("POST", set()):
            raise AssertionError(f"Backend no longer declares POST {prefix} via an empty route suffix")
        canonical = f"{api_prefix}{prefix}"
        matches = [(method, path) for method, path in api_calls if method == "POST" and path.rstrip("/") == canonical]
        if canonical != expected_path or len(matches) != 1 or matches[0][1] != canonical:
            raise AssertionError(f"Frontend {label} must use exact backend path {canonical}; found {matches}")
        verified.append({"label": label, "method": "POST", "canonical_path": canonical, "query": {}, "source_call": matches[0][1]})
    fixture_source = FIXTURE.read_text(encoding="utf-8")
    if re.search(r"url\.pathname\s*\.replace\s*\(", fixture_source):
        raise AssertionError("Browser fixture normalizes request paths and may equate slash variants")
    for path in ("/api/v1/racks/", "/api/v1/sites/", "/api/v1/devices/"):
        if path not in fixture_source:
            raise AssertionError(f"Browser fixture is missing a noncanonical-path rejection for {path}")
    if "status: 404" not in fixture_source or "nonCanonicalPaths.push" not in fixture_source:
        raise AssertionError("Browser fixture must record and return 404 for noncanonical slash paths")
    return {"status": "PASS_SOURCE_CONTRACT_ONLY", "redirect_slashes": False, "routes_checked": verified,
            "synthetic_fixture_slash_controls": ["/api/v1/racks/", "/api/v1/sites/", "/api/v1/devices/"]}


def self_test() -> list[dict]:
    bindings = source_bindings()
    document = good_openapi_fixture()
    declaration_issues = validate_rack_openapi_declarations(document)
    if declaration_issues:
        raise AssertionError(f"Positive synthetic Rack OpenAPI declarations were rejected: {declaration_issues}")
    evaluator_document = json.loads(json.dumps(document))
    provenance = {"schema": "synthetic-g2-evaluator-fixture.v1", "generated_by": "self-test-only",
                  "source_snapshot_sha256": SOURCE_SNAPSHOT, "openapi_document_sha256": sha(canonical_json(evaluator_document)),
                  "source_bindings": bindings, "source_bindings_sha256": sha(canonical_json(bindings)),
                  "main_source": str(MAIN.resolve())}
    if validate_openapi_binding(evaluator_document, provenance, bindings, allow_synthetic_fixture=True):
        raise AssertionError("Synthetic positive OpenAPI provenance fixture was unexpectedly rejected")
    identity = SYNTHETIC_IDENTITY
    observed = {"method": "GET", "url": API_ORIGIN + "/api/v1/racks?include_deleted=true", "status": 200,
                "identity": identity, "response_json": [{
                    "id": 901, "name": "SYNTHETIC-G2-RACK", "aisle": "A", "row": "01", "total_u": 42,
                    "max_power_kw": 8.0, "pdu_a_name": "PDU-A", "pdu_b_name": "PDU-B",
                    "pdu_a_cap_kw": 10.0, "pdu_b_cap_kw": 10.0, "room_id": 21, "site_id": 11,
                    "site_name": "G2 Synthetic Site", "site_color": "#3b82f6", "order_index": 0,
                    "is_deleted": False, "device_locations": [],
                }]}
    client = route_descriptor(API_ORIGIN, "GET", "/api/v1/racks", {"include_deleted": "true"}, ["tenant_id", "user_id"])
    cases = []
    pos = evaluate_g2("fixture-positive-canonical", contract=CONTRACT, client_route=client,
                      openapi_document=evaluator_document, observed=observed, expected_identity=identity,
                      source_bindings=bindings, openapi_provenance=provenance)
    if pos["gate_status"] != "PASS": raise AssertionError(f"Synthetic positive G2 control failed: {pos}")
    cases.append({"id":"canonical route with exact query/security/schema","status":"PASS","scope":"synthetic evaluator fixture only"})
    slash_client = dict(client, path="/api/v1/racks/")
    slash_obs = dict(observed, url=API_ORIGIN + "/api/v1/racks/?include_deleted=true")
    slash = evaluate_g2("fixture-negative-trailing-slash", contract=CONTRACT, client_route=slash_client,
                        openapi_document=evaluator_document, observed=slash_obs, expected_identity=identity, source_bindings=bindings)
    if slash["gate_status"] != "FAIL": raise AssertionError(f"Trailing-slash negative control did not fail: {slash}")
    cases.append({"id":"trailing slash is not equivalent","status":"PASS_REJECTED","gate":"FAIL"})
    query_client = dict(client, query={})
    query_obs = dict(observed, url=API_ORIGIN + "/api/v1/racks")
    missing_query = evaluate_g2("fixture-negative-missing-query", contract=CONTRACT, client_route=query_client,
                                openapi_document=evaluator_document, observed=query_obs, expected_identity=identity, source_bindings=bindings)
    if missing_query["gate_status"] != "FAIL": raise AssertionError(f"Missing-query negative control did not fail: {missing_query}")
    cases.append({"id":"missing include_deleted query is rejected","status":"PASS_REJECTED","gate":"FAIL"})
    missing_issues = validate_openapi_binding(None, provenance, bindings)
    if not missing_issues: raise AssertionError("Missing OpenAPI was not rejected")
    cases.append({"id":"missing OpenAPI fails closed","status":"PASS_REJECTED","gate":"BLOCKED"})
    stale = dict(provenance, openapi_document_sha256="0" * 64)
    stale_issues = validate_openapi_binding(evaluator_document, stale, bindings)
    if not any("stale" in issue or "invalid digest" in issue for issue in stale_issues): raise AssertionError("Stale OpenAPI was not rejected")
    cases.append({"id":"stale OpenAPI digest is rejected","status":"PASS_REJECTED","gate":"BLOCKED"})
    drift = dict(provenance, source_snapshot_sha256="f" * 64)
    if not validate_openapi_binding(evaluator_document, drift, bindings): raise AssertionError("Source drift was not rejected")
    cases.append({"id":"source snapshot drift is rejected","status":"PASS_REJECTED","gate":"BLOCKED"})
    no_security = json.loads(json.dumps(evaluator_document))
    no_security["paths"]["/api/v1/racks"]["get"].pop("security")
    no_security["components"].pop("securitySchemes")
    auth_fail = evaluate_g2("fixture-negative-missing-auth", contract=CONTRACT, client_route=client,
                            openapi_document=no_security, observed=observed, expected_identity=identity, source_bindings=bindings)
    if auth_fail["gate_status"] != "FAIL": raise AssertionError(f"Missing backend security declaration was not rejected: {auth_fail}")
    cases.append({"id":"backend authentication declaration required","status":"PASS_REJECTED","gate":"FAIL"})
    wrong_scheme = json.loads(json.dumps(document))
    wrong_scheme["components"]["securitySchemes"]["SysGridTrustedProxyIdentity"]["name"] = "Authorization"
    if not validate_rack_openapi_declarations(wrong_scheme):
        raise AssertionError("An invented or incorrectly bound auth header was accepted")
    cases.append({"id":"incorrect auth scheme/header is rejected","status":"PASS_REJECTED","gate":"BLOCKED_OPENAPI_DECLARATION"})
    wrong_scope = json.loads(json.dumps(document))
    wrong_scope["paths"]["/api/v1/racks"]["get"]["x-sysgrid-identity-scope"] = ["user_id"]
    if not validate_rack_openapi_declarations(wrong_scope):
        raise AssertionError("Missing tenant identity binding was accepted")
    cases.append({"id":"identity and tenant scope must both be bound","status":"PASS_REJECTED","gate":"BLOCKED_OPENAPI_DECLARATION"})
    no_schema = json.loads(json.dumps(evaluator_document))
    no_schema["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"].pop("schema")
    schema_fail = evaluate_g2("fixture-negative-missing-response-schema", contract=CONTRACT, client_route=client,
                              openapi_document=no_schema, observed=observed, expected_identity=identity, source_bindings=bindings)
    if schema_fail["gate_status"] != "FAIL": raise AssertionError(f"Missing response schema was not rejected: {schema_fail}")
    cases.append({"id":"missing backend response schema is rejected","status":"PASS_REJECTED","gate":"FAIL"})
    wrong_response = json.loads(json.dumps(evaluator_document))
    wrong_response["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"] = {"type": "object"}
    if not validate_rack_openapi_declarations(wrong_response):
        raise AssertionError("An incompatible success response shape was accepted")
    cases.append({"id":"incompatible success response schema is rejected","status":"PASS_REJECTED","gate":"BLOCKED_OPENAPI_DECLARATION"})
    missing_query = json.loads(json.dumps(document))
    missing_query["paths"]["/api/v1/racks"]["get"]["parameters"] = [
        p for p in missing_query["paths"]["/api/v1/racks"]["get"]["parameters"] if p.get("name") != "include_deleted"
    ]
    if not validate_rack_openapi_declarations(missing_query):
        raise AssertionError("Required client query parameter omission was accepted")
    cases.append({"id":"missing declared query parameter is rejected","status":"PASS_REJECTED","gate":"BLOCKED_OPENAPI_DECLARATION"})
    nullable_schema = json.loads(json.dumps(evaluator_document))
    nullable_schema["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]["properties"]["name"] = {
        "anyOf": [{"type": "string"}, {"type": "null"}]
    }
    nullable_result = evaluate_g2("fixture-positive-nullable-response", contract=CONTRACT, client_route=client,
                                  openapi_document=nullable_schema, observed=observed, expected_identity=identity,
                                  source_bindings=bindings)
    if nullable_result["gate_status"] != "PASS":
        raise AssertionError(f"Valid nullable response schema did not pass G2: {nullable_result}")
    cases.append({"id":"valid OpenAPI 3.1 nullable response schema passes","status":"PASS","gate":"PASS"})
    unsupported_schema = json.loads(json.dumps(evaluator_document))
    unsupported_schema["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]["properties"]["name"] = {
        "anyOf": [{"type": "string"}, {"type": "null"}, {"type": "integer"}]
    }
    unsupported_result = evaluate_g2("fixture-negative-unsupported-nullability", contract=CONTRACT, client_route=client,
                                     openapi_document=unsupported_schema, observed=observed, expected_identity=identity,
                                     source_bindings=bindings)
    if unsupported_result["gate_status"] != "BLOCKED":
        raise AssertionError(f"Unsupported nullable response composition was not fail-closed: {unsupported_result}")
    cases.append({"id":"complex OpenAPI composition remains blocked","status":"PASS_REJECTED","gate":"BLOCKED"})
    wrong_identity = {"user_id": "not-sysgrid-qualifier", "tenant_id": 2}
    identity_obs = dict(observed, identity=wrong_identity)
    identity_fail = evaluate_g2("fixture-negative-identity-scope", contract=CONTRACT, client_route=client,
                                openapi_document=evaluator_document, observed=identity_obs, expected_identity=identity,
                                source_bindings=bindings)
    if identity_fail["gate_status"] != "FAIL": raise AssertionError(f"Wrong synthetic identity/tenant was not rejected: {identity_fail}")
    cases.append({"id":"wrong user or tenant is rejected","status":"PASS_REJECTED","gate":"FAIL"})
    missing_tenant_observation = dict(observed, identity={"user_id": SYNTHETIC_IDENTITY["user_id"]})
    missing_tenant = evaluate_g2("fixture-negative-missing-tenant-evidence", contract=CONTRACT, client_route=client,
                                 openapi_document=evaluator_document, observed=missing_tenant_observation,
                                 expected_identity=identity, source_bindings=bindings, openapi_provenance=provenance)
    if missing_tenant["gate_status"] != "BLOCKED":
        raise AssertionError(f"Missing tenant evidence was not blocked: {missing_tenant}")
    cases.append({"id":"missing tenant evidence is blocked","status":"PASS_REJECTED","gate":"BLOCKED"})
    fabricated = dict(provenance, generated_by="hand-authored route table")
    fabricated_issues = validate_openapi_binding(document, fabricated, bindings)
    if not fabricated_issues:
        raise AssertionError("Fabricated OpenAPI origin was accepted as backend-generated")
    cases.append({"id":"fabricated OpenAPI provenance is rejected","status":"PASS_REJECTED","gate":"BLOCKED"})
    return cases


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true", help="Run synthetic evaluator positive/negative regression controls only")
    parser.add_argument("--evidence-dir", type=Path, help="Write the generated OpenAPI, provenance, and evaluator report to a new directory outside the source tree")
    parser.add_argument("--backend-python", type=Path, help="Use an explicit compatible backend interpreter (must match backend/requirements.lock)")
    args = parser.parse_args(argv)
    static = static_contract_check()
    if args.self_test:
        tests = self_test()
        print(json.dumps({"schema":"sysgrid.g2-wrapper-regressions.v1","status":"PASS_SYNTHETIC_CONTROLS_ONLY",
                          "cases":tests,"count":len(tests),"live_backend_requests":"NOT_RUN"},indent=2,sort_keys=True))
        return 0
    tests = self_test()
    backend_python = choose_backend_python(args.backend_python)
    document, provenance = generate_backend_openapi(backend_python)
    behavior = run_synthetic_asgi_probe(backend_python)
    observed = behavior["observation"]
    current_bindings = source_bindings()
    issues = validate_openapi_binding(document, provenance, current_bindings)
    if issues:
        print(json.dumps({"status":"BLOCKED_OPENAPI_PROVENANCE","issues":issues},indent=2))
        return 2
    evidence_dir = None
    if args.evidence_dir is not None:
        evidence_dir = args.evidence_dir.expanduser().resolve()
        if evidence_dir == ROOT or ROOT in evidence_dir.parents:
            raise RuntimeError("G2 evidence must be written outside the isolated source tree")
        if evidence_dir.exists() or evidence_dir.is_symlink():
            raise RuntimeError(f"G2 evidence directory already exists; refusing overwrite: {evidence_dir}")
        evidence_dir.mkdir(parents=True, mode=0o700)
        for name, value in (("backend-openapi.json", document), ("openapi-provenance.json", provenance),
                            ("source-bindings.json", current_bindings),
                            ("asgi-observation.json", observed),
                            ("asgi-test-summary.json", {"status": "PASS", "test_count": behavior["test_count"],
                                "execution": "in-process ASGI; no listening service or network request",
                                "stdout": behavior["stdout"], "stderr": behavior["stderr"]})):
            target = evidence_dir / name
            target.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    runtime = provenance["runtime"]
    if not runtime["python_supported"] or not runtime["lock_dependencies_match"]:
        report = {"schema": "sysgrid.rack-g2-openapi-report.v1", "status": "BLOCKED_RUNTIME_LOCK_MISMATCH",
                  "runtime": runtime, "live_backend_requests": "NOT_RUN", "promotion_permitted": False}
        print(json.dumps(report, indent=2, sort_keys=True))
        if evidence_dir is not None:
            report_path = evidence_dir / "g2-wrapper-report.json"
            report_path.write_text(json.dumps(report, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 2
    declaration_issues = validate_rack_openapi_declarations(document)
    if declaration_issues:
        report = {"schema": "sysgrid.rack-g2-openapi-report.v1", "status": "BLOCKED_OPENAPI_DECLARATION",
                  "issues": declaration_issues, "promotion_permitted": False}
        print(json.dumps(report, indent=2, sort_keys=True))
        if evidence_dir is not None:
            report_path = evidence_dir / "g2-wrapper-report.json"
            report_path.write_text(json.dumps(report, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 2
    openapi_operations = document.get("paths", {}).get("/api/v1/racks", {})
    get_operation = openapi_operations.get("get", {}) if isinstance(openapi_operations, dict) else {}
    query_params = [p for p in (get_operation.get("parameters") or []) if isinstance(p, dict) and p.get("in")=="query"]
    include_deleted = next((p for p in query_params if p.get("name")=="include_deleted"), None)
    success_schema = (((get_operation.get("responses") or {}).get("200") or {}).get("content") or {}).get("application/json", {}).get("schema")
    security = get_operation.get("security", document.get("security"))
    actual_contract = evaluate_g2("actual-backend-openapi", contract=CONTRACT,
        client_route=route_descriptor(API_ORIGIN,"GET","/api/v1/racks",{"include_deleted":"true"},["tenant_id","user_id"]),
        openapi_document=document, observed=observed, expected_identity=SYNTHETIC_IDENTITY,
        source_bindings=current_bindings, openapi_provenance=provenance)
    report={
      "schema":"sysgrid.rack-g2-openapi-report.v1",
      "status":"PASS_SOURCE_CONTRACT_ONLY" if actual_contract["gate_status"]=="PASS" else actual_contract["gate_status"],
      "source_snapshot_sha256":SOURCE_SNAPSHOT,"source_head":EXPECTED_HEAD,
      "static_client_backend_contract":static,
      "synthetic_regressions":{"status":"PASS","count":len(tests),"cases":tests},
      "synthetic_asgi_behavior":{"status":"PASS","test_count":behavior["test_count"],
        "execution":"actual SysGrid ASGI app in-process with disposable SQLite, no listener/network",
        "observed_method":observed["method"],"observed_path":"/api/v1/racks?include_deleted=true",
        "observed_status":observed["status"],"observed_identity":observed["identity"],
        "response_sha256":observed["response_sha256"],"production_accessed":False},
      "backend_openapi":{"origin":"actual isolated app.main:app.openapi()","document_sha256":provenance["openapi_document_sha256"],
        "source_bindings_sha256":provenance["source_bindings_sha256"],"openapi_version":provenance["openapi_version"],
        "path_count":len(document.get("paths",{})),"rack_operation_id":get_operation.get("operationId"),
        "rack_query_parameters":[{"name":p.get("name"),"required":p.get("required",False),"schema":p.get("schema")} for p in query_params],
        "include_deleted_exact_value_expected_by_client":"true","include_deleted_backend_required":bool(include_deleted and include_deleted.get("required")),
        "security_declaration_present":bool(security),"security_declaration_valid":not declaration_issues,
        "declaration_issues":declaration_issues,"success_response_schema":success_schema,
        "security_scheme_names":sorted((document.get("components",{}).get("securitySchemes") or {}).keys()),
        "runtime":provenance["runtime"],"execution":provenance["execution"]},
      "golden_g2_actual":actual_contract,
      "interpretation":{"live_backend_request":"NOT_RUN","live_identity_authorization":"NOT_RUN",
        "synthetic_asgi_request":"PASS",
        "openapi_source_authenticity":"PASS_SOURCE_GENERATED","runtime_lock_compatibility":"PASS" if provenance["runtime"]["python_supported"] and provenance["runtime"]["lock_dependencies_match"] else "BLOCKED",
        "g2_contract":actual_contract["gate_status"],
        "g2_blocker":"Golden v0.2.6 backend schema resolver rejects the backend's valid OpenAPI 3.1 anyOf nullable fields" if actual_contract["gate_status"]=="BLOCKED" else None},
      "profile_approval":profile_approval_status(),"promotion_permitted":False}
    print(json.dumps(report,indent=2,sort_keys=True))
    if evidence_dir is not None:
        report_path = evidence_dir / "g2-wrapper-report.json"
        report_path.write_text(json.dumps(report, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        hashes = {path.name: sha(path.read_bytes()) for path in sorted(evidence_dir.iterdir()) if path.is_file()}
        (evidence_dir / "evidence-manifest.json").write_text(
            json.dumps({"schema": "sysgrid.g2-evidence-manifest.v1", "files_sha256": hashes}, sort_keys=True, indent=2) + "\n",
            encoding="utf-8")
    return 0 if actual_contract["gate_status"]=="PASS" and report["interpretation"]["runtime_lock_compatibility"]=="PASS" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status":"FAIL","error":str(error)},sort_keys=True),file=sys.stderr)
        raise
