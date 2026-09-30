#!/usr/bin/env python3
"""Build, configure, initialize, and serve SysGrid on a single PaaS app."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DATA_ENV = "SYSGRID_DATA_ROOT"
IDENTITY = re.compile(r"^[^,\s\x00-\x1f]{1,200}$")
HEADER = re.compile(r"^[A-Za-z][A-Za-z0-9-]*$")


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def data_root() -> Path:
    raw = os.getenv(DATA_ENV, "").strip()
    if not raw:
        fail(f"Set {DATA_ENV} to your PaaS persistent volume's absolute directory.")
    path = Path(raw).expanduser()
    if not path.is_absolute() or ".." in path.parts:
        fail(f"{DATA_ENV} must be an absolute directory without '..'.")
    path = path.resolve()
    if not path.is_dir() or not os.access(path, os.W_OK):
        fail(f"{DATA_ENV} must already exist and be writable by this app.")
    if path.is_relative_to(ROOT) or path.is_relative_to(Path(tempfile.gettempdir()).resolve()):
        fail(f"{DATA_ENV} must be persistent storage outside the checkout and temporary directory.")
    return path


def config_path() -> Path:
    return data_root() / "sysgrid" / "paas.json"


def validated_url(value: str) -> tuple[str, str]:
    parsed = urlsplit(value.strip())
    if (parsed.scheme != "https" or not parsed.hostname or parsed.path not in ("", "/")
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        fail("--url must be the public HTTPS origin, such as https://sysgrid.company.com")
    return f"https://{parsed.netloc}", parsed.hostname


def validated_identity(value: str, label: str) -> str:
    if not IDENTITY.fullmatch(value):
        fail(f"{label} must be one exact authenticated user ID without spaces or commas.")
    return value


def read_config() -> dict[str, str]:
    path = config_path()
    if not path.is_file():
        fail("No configuration exists. Run: python3 scripts/paas.py configure --url URL --admin USER --system-root USER")
    if path.stat().st_mode & 0o077:
        fail("Configuration file is accessible to other users. Restrict it to mode 0600.")
    try:
        config = json.loads(path.read_text())
    except (ValueError, OSError):
        fail("Configuration file could not be read.")
    if config.get("version") != 1:
        fail("Unsupported configuration version.")
    required = ("origin", "hostname", "admin", "system_root", "identity_header", "signing_key")
    if any(not isinstance(config.get(name), str) or not config[name] for name in required):
        fail("Configuration file is incomplete. Review the persistent volume before startup.")
    return config


def configure(args: argparse.Namespace) -> None:
    origin, hostname = validated_url(args.url)
    admin = validated_identity(args.admin, "--admin")
    system_root = validated_identity(args.system_root, "--system-root")
    if admin == system_root:
        fail("Use a separate identity for --system-root.")
    if not HEADER.fullmatch(args.identity_header) or args.identity_header.lower() == "x-user-id":
        fail("--identity-header must name a trusted proxy header other than X-User-Id.")

    path = config_path()
    if path.exists():
        fail("Configuration already exists. The setup command will not overwrite a running installation.")
    path.parent.mkdir(mode=0o700, exist_ok=True)
    if path.parent.stat().st_mode & 0o077:
        fail("SysGrid data directory is accessible to other users. Restrict it to mode 0700.")
    config = {
        "version": 1,
        "origin": origin,
        "hostname": hostname,
        "admin": admin,
        "system_root": system_root,
        "identity_header": args.identity_header,
        "signing_key": secrets.token_urlsafe(48),
    }
    try:
        with path.open("x") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(config, stream, sort_keys=True)
            stream.write("\n")
    except FileExistsError:
        fail("Configuration already exists. It was not changed.")
    print("Configuration saved on the persistent volume. Next: python3 scripts/paas.py init")
    print("Your PaaS gateway must authenticate users and supply the trusted identity header.")


def release_sha() -> str:
    """Identify the installed source/build without requiring a .git directory."""
    digest = hashlib.sha256()
    sources = [
        BACKEND / "requirements.lock", BACKEND / "alembic.ini", ROOT / "scripts" / "paas.py",
        *BACKEND.joinpath("app").rglob("*.py"),
        *BACKEND.joinpath("alembic").rglob("*.py"),
        *FRONTEND.joinpath("dist").rglob("*"),
    ]
    for path in sorted((path for path in sources if path.is_file()), key=str):
        digest.update(str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path.name).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def runtime_env(config: dict[str, str]) -> dict[str, str]:
    root = config_path().parent
    env = os.environ.copy()
    env.pop("SQLALCHEMY_DATABASE_URL", None)
    env.pop("TESTING", None)
    candidate = release_sha()
    env.update({
        "ENVIRONMENT": "production",
        "BACKEND_CORS_ORIGINS": config["origin"],
        "ALLOWED_HOSTS": config["hostname"],
        "IDENTITY_MODE": "trusted_proxy",
        "TRUSTED_PROXY_USER_HEADER": config["identity_header"],
        "DATABASE_URL": f"sqlite+aiosqlite:///{root / 'default.db'}",
        "CONFIG_DATABASE_URL": f"sqlite+aiosqlite:///{root / 'config.db'}",
        "TENANT_STORAGE_ROOT": str(root / "tenants"),
        "PUBLIC_READONLY_ENABLED": "false",
        "ALLOW_PUBLIC_READONLY_IN_PRODUCTION": "false",
        "DEFAULT_USER_ID": "sysgrid-service",
        "AUTO_ADMIN_USER_IDS": "",
        "ALLOW_AUTO_ADMIN_IN_PRODUCTION": "false",
        "CONTROL_PLANE_ADMIN_USER_IDS": config["admin"],
        "CONTROL_PLANE_BOOTSTRAP_ENABLED": "false",
        "CONTROL_PLANE_BOOTSTRAP_USER_ID": "",
        "SYSTEM_ROOT_USER_IDS": config["system_root"],
        "SCHEDULE_PREVIEW_SIGNING_KEY": config["signing_key"],
        "PV1_RELEASE_CANDIDATE_SHA": candidate,
        "PV1_RELEASE_ID": f"paas-{candidate[:12]}",
        "AUTO_MIGRATE_ON_STARTUP": "false",
        "ALLOW_AUTO_MIGRATE_IN_PRODUCTION": "false",
    })
    return env


def validate_runtime(env: dict[str, str]) -> None:
    if not (FRONTEND / "dist" / "index.html").is_file():
        fail("Frontend build is missing. Run: python3 scripts/paas.py build")
    old_env = os.environ.copy()
    old_cwd = Path.cwd()
    try:
        os.environ.clear()
        os.environ.update(env)
        os.chdir(ROOT)
        sys.path.insert(0, str(BACKEND))
        from app.core.config import Settings
        errors = Settings(_env_file=None).production_guard_errors()
    finally:
        os.chdir(old_cwd)
        os.environ.clear()
        os.environ.update(old_env)
    if errors:
        fail(f"Production configuration has {len(errors)} error(s). No database changes were made.")


def build() -> None:
    if sys.version_info < (3, 12):
        fail("Python 3.12 or newer is required.")
    try:
        node_version = subprocess.check_output(["node", "-p", "process.versions.node"], text=True).strip()
        node_parts = tuple(int(part) for part in node_version.split(".")[:2])
    except (OSError, subprocess.CalledProcessError, ValueError):
        fail("Node.js 22 LTS and npm must be available to build the frontend.")
    if node_parts[0] != 22 or node_parts < (22, 13):
        fail("The frontend build requires Node.js 22.13 or newer within Node 22.")
    print("Installing locked backend dependencies...")
    if subprocess.run([sys.executable, "-m", "pip", "install", "--require-hashes", "-r", "requirements.lock"],
                      cwd=BACKEND, check=False).returncode:
        fail("Locked backend installation failed. See the pip error above.")
    print("Installing and building the desktop frontend...")
    env = os.environ.copy()
    env["VITE_API_BASE_URL"] = ""
    env["VITE_IDENTITY_MODE"] = "trusted_proxy"
    if subprocess.run(["npm", "ci"], cwd=FRONTEND, env=env, check=False).returncode:
        fail("Locked frontend installation failed. See the npm error above.")
    if subprocess.run(["npm", "run", "build"], cwd=FRONTEND, env=env, check=False).returncode:
        fail("Frontend build failed. See the npm error above.")
    if not (FRONTEND / "dist" / "index.html").is_file():
        fail("Frontend build did not create dist/index.html.")
    print("Build complete. The Python app serves both the API and desktop UI.")


def inspect_installation(root: Path) -> str:
    config_db = root / "config.db"
    default_db = root / "default.db"
    if not config_db.exists() and not default_db.exists():
        tenant_root = root / "tenants"
        if tenant_root.exists() and list(tenant_root.glob("*.db")):
            fail("Tenant files exist without the configuration database. Review storage before initialization.")
        return "new"
    if not config_db.exists() or not default_db.exists():
        fail("A partial database set exists. Review storage before initialization.")
    import sqlite3
    try:
        connection = sqlite3.connect(f"file:{config_db}?mode=ro", uri=True)
        try:
            count = connection.execute("SELECT count(*) FROM tenants").fetchone()[0]
        finally:
            connection.close()
    except sqlite3.DatabaseError:
        fail("Existing configuration database cannot be read. Review storage before initialization.")
    if count:
        return "existing"
    fail("A partial database set exists. Review storage before initialization.")


def verify_existing_schema(root: Path) -> None:
    """Refuse an upgraded binary if persistent database schemas lag behind it."""
    import sqlite3
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from app.models.config import ConfigBase

    expected_revisions = set(ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini"))).get_heads())
    config_db = sqlite3.connect(f"file:{root / 'config.db'}?mode=ro", uri=True)
    try:
        for table in ConfigBase.metadata.tables.values():
            actual = {row[1] for row in config_db.execute(f"PRAGMA table_info({table.name})")}
            if not set(table.columns.keys()).issubset(actual):
                fail(f"Configuration schema is older than this release ({table.name}). Keep the app stopped and use the reviewed upgrade procedure.")
        tenant_urls = [row[0] for row in config_db.execute("SELECT db_url FROM tenants")]
    finally:
        config_db.close()

    urls = [f"sqlite+aiosqlite:///{root / 'default.db'}", *tenant_urls]
    for url in set(urls):
        prefix = "sqlite+aiosqlite:///"
        if not url.startswith(prefix):
            fail("A registered tenant uses unsupported storage. Review the database registry.")
        path = Path(url[len(prefix):])
        if not path.is_file():
            fail("A registered database file is missing. Review persistent storage before startup.")
        try:
            connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            try:
                revisions = {row[0] for row in connection.execute("SELECT version_num FROM alembic_version")}
            finally:
                connection.close()
        except sqlite3.DatabaseError:
            fail("A registered database revision could not be read. Review storage before startup.")
        if revisions != expected_revisions:
            fail("A database schema is older than this release. Keep the app stopped and use the reviewed upgrade procedure.")


def initialize(env: dict[str, str]) -> None:
    root = config_path().parent
    state = inspect_installation(root)
    if state == "existing":
        verify_existing_schema(root)
        print("Existing tenant data found. Initialization skipped; no databases were changed.")
        return
    (root / "tenants").mkdir(mode=0o700, exist_ok=True)
    print("Creating the first database and tenant...")
    if subprocess.run([sys.executable, "-m", "app.paas_bootstrap"], cwd=BACKEND, env=env, check=False).returncode:
        fail("First-tenant setup failed. A partial database set may exist; review storage before retrying.")
    verify_existing_schema(root)
    print("First tenant created. Open the public app URL as the configured admin user.")


def serve(env: dict[str, str]) -> None:
    initialize(env)
    os.environ.clear()
    os.environ.update(env)
    os.chdir(BACKEND)
    import uvicorn
    uvicorn.run("app.paas:app", host="0.0.0.0", port=int(env.get("PORT", "8000")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("build", help="install locked dependencies and build the UI")
    configure_parser = commands.add_parser("configure", help="save first-install configuration to persistent storage")
    configure_parser.add_argument("--url", required=True, help="public HTTPS URL of this app")
    configure_parser.add_argument("--admin", required=True, help="exact authenticated user ID of first administrator")
    configure_parser.add_argument("--system-root", required=True, help="different reserved System Root identity")
    configure_parser.add_argument("--identity-header", default="X-Authenticated-User")
    commands.add_parser("init", help="create first databases and tenant once")
    commands.add_parser("check", help="validate configuration without changing data")
    commands.add_parser("serve", help="start the combined API and UI")
    args = parser.parse_args()
    if args.command == "build":
        build()
    elif args.command == "configure":
        configure(args)
    else:
        if args.command == "serve" and not config_path().exists():
            required = ("SYSGRID_PUBLIC_URL", "SYSGRID_ADMIN_ID", "SYSGRID_SYSTEM_ROOT_ID")
            missing = [name for name in required if not os.getenv(name)]
            if missing:
                fail("First launch needs " + ", ".join(missing) + ". See PAAS-START.md.")
            configure(argparse.Namespace(
                url=os.environ["SYSGRID_PUBLIC_URL"],
                admin=os.environ["SYSGRID_ADMIN_ID"],
                system_root=os.environ["SYSGRID_SYSTEM_ROOT_ID"],
                identity_header=os.getenv("SYSGRID_IDENTITY_HEADER", "X-Authenticated-User"),
            ))
        config = read_config()
        env = runtime_env(config)
        validate_runtime(env)
        if args.command == "init":
            initialize(env)
        elif args.command == "check":
            print("Configuration and frontend build are valid.")
            state = inspect_installation(config_path().parent)
            if state == "existing":
                verify_existing_schema(config_path().parent)
            print("Database state:", state)
        else:
            serve(env)


if __name__ == "__main__":
    main()
