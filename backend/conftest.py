import hashlib
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

_REPO_BACKEND_DIR = Path(__file__).resolve().parent


def _dotenv_value(name: str) -> str | None:
    env_path = _REPO_BACKEND_DIR / ".env"
    if not env_path.is_file():
        return None
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != name:
            continue
        return value.strip().strip('"').strip("'")
    return None


def _configured_value(name: str, default: str) -> str:
    return os.environ.get(name) or _dotenv_value(name) or default


def _sqlite_file_from_url(db_url: str | None) -> Path | None:
    if not db_url:
        return None
    raw = None
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if db_url.startswith(prefix):
            raw = db_url[len(prefix):]
            break
    if not raw or raw == ":memory:":
        return None
    path = Path(raw).expanduser()
    return (path if path.is_absolute() else _REPO_BACKEND_DIR / path).resolve()


def _registered_local_demo_path(config_path: Path | None) -> Path | None:
    if config_path is None or not config_path.is_file():
        return None
    try:
        connection = sqlite3.connect(f"file:{config_path}?mode=ro", uri=True)
        row = connection.execute(
            "SELECT db_url FROM tenants WHERE name = 'Local Demo' LIMIT 1"
        ).fetchone()
        connection.close()
    except sqlite3.Error:
        return None
    return _sqlite_file_from_url(row[0]) if row and row[0] else None


def _file_snapshot(path: Path | None) -> dict:
    if path is None or not path.is_file():
        return {"path": str(path) if path else None, "exists": False}
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    stat = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "sha256": digest,
    }


_ORIGINAL_CONFIG_PATH = _sqlite_file_from_url(
    _configured_value("CONFIG_DATABASE_URL", f"sqlite+aiosqlite:///{_REPO_BACKEND_DIR / 'config.db'}")
)
_ORIGINAL_DATABASE_PATH = _sqlite_file_from_url(
    _configured_value("DATABASE_URL", f"sqlite+aiosqlite:///{_REPO_BACKEND_DIR / 'system_grid.db'}")
)
_ORIGINAL_LOCAL_DEMO_PATH = _registered_local_demo_path(_ORIGINAL_CONFIG_PATH)
_ORIGINAL_USER_DATABASE_PATHS = tuple(
    dict.fromkeys(
        path
        for path in (_ORIGINAL_CONFIG_PATH, _ORIGINAL_DATABASE_PATH, _ORIGINAL_LOCAL_DEMO_PATH)
        if path is not None
    )
)
_ORIGINAL_USER_DATABASE_SNAPSHOT = {
    str(path): _file_snapshot(path) for path in _ORIGINAL_USER_DATABASE_PATHS
}

# Establish the disposable namespace before importing app.database, app.main,
# or app.core.config. No application singleton may be constructed from a
# developer's configured Local Demo paths during test collection.
_TEST_ISOLATION_ROOT = Path(tempfile.mkdtemp(prefix="sysgrid-pytest-"))
_TEST_CONFIG_PATH = _TEST_ISOLATION_ROOT / "config.db"
_TEST_DATABASE_PATH = _TEST_ISOLATION_ROOT / "tenant.db"
_TEST_TENANT_ROOT = _TEST_ISOLATION_ROOT / "tenants"
os.environ["TESTING"] = "1"
os.environ["ENVIRONMENT"] = "test"
os.environ["CONFIG_DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_CONFIG_PATH}"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DATABASE_PATH}"
os.environ["TENANT_STORAGE_ROOT"] = str(_TEST_TENANT_ROOT)
# Test-only explicit control-plane identity. Production configuration is
# required to provide its own deployment-specific allow-list.
os.environ["CONTROL_PLANE_ADMIN_USER_IDS"] = "admin_root"

import pytest_asyncio
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import select # Import select here

from app.database import (
    Base,
    get_db,
    get_config_db,
    ConfigSessionLocal as ProductionConfigSessionLocal,
    build_engine,
    get_tenant_engine,
)
from app.models.config import ConfigBase, Tenant, UserTenantAccess
from app.main import app
from app.core.config import settings
from app.models import models  # noqa: F401
from fastapi import Request


def _sha256_if_file(path: Path | None) -> str | None:
    if path is None or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@pytest.fixture(scope="session", autouse=True)
def protect_user_databases():
    """Fail if qualification tests touch any configured user database."""
    configured_paths = {
        _sqlite_file_from_url(settings.CONFIG_DATABASE_URL),
        _sqlite_file_from_url(settings.DATABASE_URL),
        Path(settings.TENANT_STORAGE_ROOT).resolve(),
    }
    if any(path in _ORIGINAL_USER_DATABASE_PATHS for path in configured_paths if path is not None):
        raise RuntimeError("Backend tests were not bound to the disposable database namespace.")
    yield
    after = {
        str(path): _file_snapshot(path) for path in _ORIGINAL_USER_DATABASE_PATHS
    }
    assert after == _ORIGINAL_USER_DATABASE_SNAPSHOT, (
        "Qualification tests modified a configured user database. "
        f"before={_ORIGINAL_USER_DATABASE_SNAPSHOT!r} after={after!r}"
    )

@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_db(tmp_path_factory, monkeypatch, tmp_path):
    # Create unique SQLite database files for this test module
    config_db_path = tmp_path_factory.mktemp("config_db") / "test_config.db"
    tenant_a_db_path = tmp_path_factory.mktemp("tenant_a_db") / "test_tenant_a.db"
    tenant_b_db_path = tmp_path_factory.mktemp("tenant_b_db") / "test_tenant_b.db"

    test_config_db_url = f"sqlite+aiosqlite:///{config_db_path}"
    test_tenant_a_db_url = f"sqlite+aiosqlite:///{tenant_a_db_path}"
    test_tenant_b_db_url = f"sqlite+aiosqlite:///{tenant_b_db_path}"

    monkeypatch.setenv("TESTING", "1") # Set testing environment variable

    # Rebuild config_engine and ConfigSessionLocal with unique URL
    global _test_config_engine # Declare as global to be accessible later

    _test_config_engine = build_engine(test_config_db_url) # Assign to global variable
    test_config_session_local = async_sessionmaker(
        bind=_test_config_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=True,
        class_=AsyncSession
    )

    # Patch app.database.config_engine and app.database.ConfigSessionLocal
    # to point to the test-specific instances
    monkeypatch.setattr("app.database.config_engine", _test_config_engine)
    monkeypatch.setattr("app.database.ConfigSessionLocal", test_config_session_local)

    # Test modules historically imported ConfigSessionLocal directly at module
    # import time. Rebind every such alias to the temporary registry so no
    # backend test can write through a stale production sessionmaker reference.
    for module in list(sys.modules.values()):
        if module is None:
            continue
        if getattr(module, "ConfigSessionLocal", None) is ProductionConfigSessionLocal:
            monkeypatch.setattr(module, "ConfigSessionLocal", test_config_session_local, raising=False)

    # Override the app's get_db and get_config_db dependencies for testing
    async def override_get_config_db():
        async with test_config_session_local() as session:
            yield session

    async def override_get_db(request: Request):
        from app.api.utils import get_current_user_id
        from app.models.config import Tenant, UserTenantAccess
        from fastapi import HTTPException, status # Import these for use in the override

        user_id = get_current_user_id(request)
        tenant_url = None
        current_tenant_id = None
        selected_access_role = None
        selected_tenant = None # Initialize selected_tenant here

        # Prioritize X-Tenant-Id exactly as the production dependency does.
        # A supplied but inactive/missing tenant must not fall through to another
        # accessible tenant, because that would hide routing and isolation bugs.
        x_tenant_id = request.headers.get("X-Tenant-Id")
        if x_tenant_id:
            async with test_config_session_local() as config_db:
                try:
                    tenant_identifier = int(x_tenant_id)
                    tenant_stmt = select(Tenant).filter(
                        Tenant.id == tenant_identifier,
                        Tenant.is_active == True,
                    )
                except ValueError:
                    tenant_stmt = select(Tenant).filter(
                        Tenant.name == x_tenant_id,
                        Tenant.is_active == True,
                    )

                tenant_result = await config_db.execute(tenant_stmt)
                selected_tenant = tenant_result.scalar_one_or_none()

                if not selected_tenant:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Tenant '{x_tenant_id}' not found.",
                    )

                access_stmt = select(UserTenantAccess).filter(
                    UserTenantAccess.user_id == user_id,
                    UserTenantAccess.tenant_id == selected_tenant.id,
                )
                access_result = await config_db.execute(access_stmt)
                user_access = access_result.scalar_one_or_none()

                if not user_access:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"User '{user_id}' does not have access to tenant '{x_tenant_id}'.",
                    )

                tenant_url = selected_tenant.db_url
                current_tenant_id = selected_tenant.id
                selected_access_role = user_access.role

        if not x_tenant_id and not selected_tenant:
            # Use the *test-specific* current_ConfigSessionLocal for all config_db interactions
            async with test_config_session_local() as config_db:
                # Simplified tenant selection logic for tests
                # Try to find a tenant where the current user is an admin
                # For simplicity in testing, we'll auto-select the first active tenant the user has access to.
                user_access_stmt = select(Tenant).join(UserTenantAccess).filter(
                    UserTenantAccess.user_id == user_id,
                    UserTenantAccess.role == "ADMIN",
                    Tenant.is_active == True # Assuming active tenants are preferable
                ).order_by(Tenant.id.asc()) # Order by ID to get a deterministic "first" tenant

                tenant_result = await config_db.execute(user_access_stmt)
                selected_tenant = tenant_result.scalar_one_or_none()

                if not selected_tenant:
                    # Fallback: if no admin tenant, get any tenant the user has access to
                    user_access_stmt = select(Tenant).join(UserTenantAccess).filter(
                        UserTenantAccess.user_id == user_id,
                        Tenant.is_active == True
                    ).order_by(Tenant.id.asc())
                    tenant_result = await config_db.execute(user_access_stmt)
                    selected_tenant = tenant_result.scalar_one_or_none()


                if not selected_tenant:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"User '{user_id}' has no access to any tenant in test environment."
                    )
                
                tenant_url = selected_tenant.db_url
                current_tenant_id = selected_tenant.id
                role_result = await config_db.execute(
                    select(UserTenantAccess.role).filter(
                        UserTenantAccess.user_id == user_id,
                        UserTenantAccess.tenant_id == selected_tenant.id,
                    )
                )
                selected_access_role = role_result.scalar_one_or_none()

        # Now, provide session for the target DB (tenant DB)
        # This will call app.database.get_tenant_engine, which is now cache-bypassing in TESTING mode
        engine = get_tenant_engine(tenant_url)
        session_factory = async_sessionmaker(
            bind=engine,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            class_=AsyncSession
        )
        
        async with session_factory() as session:
            try:
                request.state.sysgrid_access_role = selected_access_role or "VIEWER"
                request.state.tenant_id = current_tenant_id # Store tenant ID
                yield session
            finally:
                await session.close()

    app.dependency_overrides[get_db] = override_get_db

    async with _test_config_engine.begin() as conn:
        # These are for the config models (ConfigBase)
        await conn.run_sync(ConfigBase.metadata.drop_all)
        await conn.run_sync(ConfigBase.metadata.create_all)
    
    app.dependency_overrides[get_config_db] = override_get_config_db

    yield _test_config_engine, test_config_session_local
    # Teardown
    app.dependency_overrides.clear()
    
    # Dispose of the global test_config_engine
    if _test_config_engine:
        await _test_config_engine.dispose()
        # _test_config_engine = None # Clear reference, not strictly necessary as it's reassigned next time


@pytest_asyncio.fixture(scope="module")
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture(scope="function")
async def seeded_admin_tenant(client, tmp_path, tmp_path_factory, setup_db):
    _test_config_engine, ConfigSessionLocal = setup_db
    """
    Fixture to create and seed a unique tenant for the 'admin_root' user.
    Tests requiring a pre-existing tenant can depend on this fixture.
    """
    from app.models.config import Tenant, UserTenantAccess
    from app.database import Base # Keep Base for potential future use, though not used directly for schema creation here
    from app.api.tenants import run_alembic_upgrade # Import the migration function

    tenant_name = f"Admin Root Tenant {tmp_path.name}"
    tenant_db_path = tmp_path_factory.mktemp(f"seeded_tenant_db_{tmp_path.name}") / f"admin_root_tenant_{tmp_path.name}.db"
    tenant_db_url = f"sqlite+aiosqlite:///{tenant_db_path}"

    # Use the test-specific ConfigSessionLocal for seeding
    async with ConfigSessionLocal() as config_session:
        # Create a test tenant
        new_tenant = Tenant(name=tenant_name, db_url=tenant_db_url, is_active=True)
        config_session.add(new_tenant)
        await config_session.flush() # Flush to get tenant.id

        # IMPORTANT: Access attributes BEFORE committing the session,
        # otherwise the object will be detached.
        tenant_id = new_tenant.id 
        tenant_name = new_tenant.name

        # Grant admin_root access to this tenant
        config_session.add(UserTenantAccess(user_id="admin_root", tenant_id=tenant_id, role="ADMIN", is_selected=True))
        await config_session.commit()

    # Now, run alembic migrations on this newly created tenant's database
    success, error_msg = run_alembic_upgrade(tenant_db_url)
    if not success:
        pytest.fail(f"Alembic migration failed for seeded tenant {tenant_name}: {error_msg}")
    
    # We don't need to dispose the engine here as run_alembic_upgrade uses subprocess.
    
    return {"tenant_id": tenant_id, "tenant_name": tenant_name, "client": client}
