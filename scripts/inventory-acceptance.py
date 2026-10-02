"""Read registered API contracts without starting services or opening databases.

This is an acceptance worklist, not a claim that its entries have passed review.
Run with the locked backend environment; output is an immutable JSON artifact.
"""
import argparse
import hashlib
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def source(call):
    path = inspect.getsourcefile(call)
    if not path or not Path(path).is_relative_to(ROOT):
        return {"owner": getattr(call, '__qualname__', str(type(call)))}
    return {"owner": f"{call.__module__}.{call.__qualname__}",
            "file": str(Path(path).relative_to(ROOT)), "line": inspect.getsourcelines(call)[1]}


def dependencies(dependant):
    result = []
    for child in dependant.dependencies:
        result.append(source(child.call))
        result.extend(dependencies(child))
    return result


def registered_routes(routes, prefix=''):
    for route in routes:
        # FastAPI's locked version retains included routers lazily. Also support
        # expanded APIRoutes so inventory checks survive an explicit lock update.
        if hasattr(route, 'original_router'):
            yield from registered_routes(route.original_router.routes, prefix + route.include_context.prefix)
        elif hasattr(route, 'dependant'):
            yield prefix + route.path, route


def collect():
    original_cwd = Path.cwd()
    with tempfile.TemporaryDirectory(prefix='sysgrid-inventory-') as temporary:
        # Import only the route graph in an isolated configuration. Never enter
        # lifespan, run migrations, load an operator .env, or query live data.
        os.chdir(temporary)
        os.environ.update(TESTING='1', ENVIRONMENT='development', IDENTITY_MODE='development',
                          DATABASE_URL='sqlite+aiosqlite:///:memory:', CONFIG_DATABASE_URL='sqlite+aiosqlite:///:memory:',
                          TENANT_STORAGE_ROOT=temporary, AUTO_MIGRATE_ON_STARTUP='false')
        sys.path.insert(0, str(ROOT / 'backend'))
        try:
            from app.main import app
            openapi = app.openapi()
            entries = []
            for path, route in registered_routes(app.routes):
                for method in sorted(getattr(route, 'methods', None) or {'WEBSOCKET'}):
                    contract = openapi.get('paths', {}).get(path, {}).get(method.lower(), {})
                    entries.append({"id": f"{method} {path}", "method": method, "path": path,
                                    **source(route.endpoint), "dependencies": dependencies(route.dependant),
                                    "request_body": contract.get('requestBody'), "parameters": contract.get('parameters', []),
                                    "responses": contract.get('responses', {}), "status": "requires_qualification"})
            declared = {(method.upper(), path) for path, methods in openapi['paths'].items()
                        for method in methods if method in {'get', 'post', 'put', 'patch', 'delete', 'head', 'options'}}
            observed = {(entry['method'], entry['path']) for entry in entries}
            if declared - observed:
                raise RuntimeError(f"Registered API owners missing for {sorted(declared - observed)}")
            source_files = {item['file'] for entry in entries for item in [entry, *entry['dependencies']] if 'file' in item}
            return {"schema_version": 1, "kind": "registered_api_acceptance_inventory",
                    "source_head": subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
                    "contract_sha256": hashlib.sha256(json.dumps(openapi, sort_keys=True).encode()).hexdigest(),
                    "source_files": {file: hashlib.sha256((ROOT / file).read_bytes()).hexdigest() for file in sorted(source_files)},
                    "limitations": ["Dependency declarations are not a complete authorization proof; domain guards must also be reviewed.",
                                    "Presence in this inventory is not behavioral, security, performance or field acceptance."],
                    "entries": sorted(entries, key=lambda entry: entry['id'])}
        finally:
            os.chdir(original_cwd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    inventory = collect()
    with args.output.open('x') as handle:
        json.dump(inventory, handle, indent=2)
        handle.write('\n')
    print(json.dumps({"entries": len(inventory['entries']), "output": str(args.output)}))
