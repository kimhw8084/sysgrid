from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import event, MetaData, select
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool
from .core.config import settings
import os
from .database_base import Base, ConfigBase

SAFE_READ_METHODS = {"GET", "HEAD", "OPTIONS"}


# 1. Master Configuration Database (Always Local)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DATABASE_URL = settings.CONFIG_DATABASE_URL

def is_sqlite_url(db_url: str) -> bool:
    return db_url.startswith("sqlite")

def sqlite_path_from_url(db_url: str) -> str | None:
    prefixes = ("sqlite+aiosqlite:///", "sqlite:///")
    for prefix in prefixes:
        if db_url.startswith(prefix):
            return db_url.replace(prefix, "", 1)
    return None

def build_engine(db_url: str):
    engine_args = {"pool_pre_ping": True}
    if is_sqlite_url(db_url):
        # PV1 qualification exercises 50 active clients against the isolated
        # SQLite profile.  The previous default queue (five connections)
        # serialized otherwise independent reads before they reached the
        # bounded WAL database.  Keep a bounded pool sized to the declared
        # local concurrency; SQLite still serializes writers through WAL.
        # aiosqlite defaults to NullPool. Production uses the existing bounded
        # local-concurrency profile; disposable test databases use NullPool so
        # the fixture's many short-lived tenant engines do not retain FDs.
        if os.getenv("TESTING") == "1":
            engine_args["poolclass"] = NullPool
        else:
            engine_args.update({"poolclass": AsyncAdaptedQueuePool, "pool_size": 50, "max_overflow": 0})
        engine_args["connect_args"] = {"check_same_thread": False, "timeout": 60}
    return create_async_engine(db_url, **engine_args)

config_engine = build_engine(CONFIG_DATABASE_URL)

if is_sqlite_url(CONFIG_DATABASE_URL):
    @event.listens_for(config_engine.sync_engine, "connect")
    def set_config_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # Do not change the persistent journal mode while resolving a tenant.
        # GET/HEAD/OPTIONS paths use this engine for read-only configuration
        # lookup, and PRAGMA journal_mode=WAL itself mutates the config file.
        # Tenant provisioning/migration may choose WAL explicitly on its
        # authorized mutation path; connection setup must remain read-only.
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

ConfigSessionLocal = async_sessionmaker(
    bind=config_engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=True,
    class_=AsyncSession
)

# 2. Dynamic Tenant Database Management
# Engine cache to avoid recreating engines on every request
engine_cache = {}

def get_tenant_engine(db_url: str):
    # Convert relative sqlite paths to absolute paths
    if is_sqlite_url(db_url):
        path = sqlite_path_from_url(db_url)
        if path and path.startswith("./"):
            # Resolve path relative to the backend directory
            backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            absolute_path = os.path.join(backend_dir, path)
            db_url = db_url.replace(path, absolute_path)
            
    if db_url not in engine_cache:
        new_engine = build_engine(db_url)
        
        # Enable WAL mode for production reliability
        if is_sqlite_url(db_url):
            @event.listens_for(new_engine.sync_engine, "connect")
            def set_sqlite_pragma(dbapi_connection, connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
            
        engine_cache[db_url] = new_engine
        
    return engine_cache[db_url]

# Legacy/Default Session for internal use (seeding, etc)
default_engine = get_tenant_engine(settings.DATABASE_URL)
engine = default_engine # Restore global 'engine' for backward compatibility
AsyncSessionLocal = async_sessionmaker(
    bind=default_engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=True,
    class_=AsyncSession
)

# 3. Standard Metadata and Base
naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
}

metadata = MetaData(naming_convention=naming_convention)
Base = declarative_base(metadata=metadata)

# 4. Dependencies
async def get_config_db():
    async with ConfigSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def get_db(request: Request):
    """
    Dynamic DB dependency. Determines tenant DB based on USER_ID.
    """
    from .api.utils import get_current_user_id
    from .models.config import Tenant, UserTenantAccess

    # 1. Get User ID and Tenant ID from request headers
    user_id = get_current_user_id(request)
    request_method = (request.method or "GET").upper()
    is_safe_read = request_method in SAFE_READ_METHODS
    
    header_tenant_id = request.headers.get("X-Tenant-Id")
    tenant_url = None
    access_role = "VIEWER"
    current_tenant_id = None

    async with ConfigSessionLocal() as config_db:
        # Prioritize tenant from X-Tenant-Id header if present
        if header_tenant_id:
            try:
                # Attempt to convert to int if it's an ID, otherwise treat as name
                tenant_identifier = int(header_tenant_id)
                tenant_stmt = select(Tenant).filter(
                    Tenant.id == tenant_identifier,
                    Tenant.is_active == True,
                )
            except ValueError:
                tenant_stmt = select(Tenant).filter(
                    Tenant.name == header_tenant_id,
                    Tenant.is_active == True,
                )
            
            tenant_result = await config_db.execute(tenant_stmt)
            target_tenant = tenant_result.scalar_one_or_none()

            if target_tenant:
                user_access_stmt = select(UserTenantAccess).filter(
                    UserTenantAccess.user_id == user_id,
                    UserTenantAccess.tenant_id == target_tenant.id
                )
                user_access_result = await config_db.execute(user_access_stmt)
                user_access = user_access_result.scalar_one_or_none()

                if user_access:
                    tenant_url = target_tenant.db_url
                    access_role = user_access.role
                    current_tenant_id = target_tenant.id
                else:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"User '{user_id}' does not have access to tenant '{header_tenant_id}'."
                    )
            else:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Tenant '{header_tenant_id}' not found."
                )
        
        # Fallback to selected tenant logic if no header or header logic didn't yield a tenant
        if not tenant_url:
            selected_stmt = (
                select(Tenant.db_url, UserTenantAccess.role, Tenant.id)
                .join(UserTenantAccess)
                .filter(UserTenantAccess.user_id == user_id)
                .filter(UserTenantAccess.is_selected == True)
                .filter(Tenant.is_active == True)
            )
            selected_result = await config_db.execute(selected_stmt)
            selected_access = selected_result.first()

            tenant_url = selected_access[0] if selected_access else None
            access_role = (selected_access[1] if selected_access else None) or "VIEWER"
            current_tenant_id = selected_access[2] if selected_access else None

            # Read-only resolution must not provision or mutate config state.
            # Explicit tenant selection/provisioning belongs to its authorized
            # mutation endpoint; GET/HEAD/OPTIONS only resolve an existing row.
            if not tenant_url:
                fallback_access_stmt = (
                    select(Tenant.db_url, UserTenantAccess.role, Tenant.id)
                    .join(UserTenantAccess)
                    .filter(UserTenantAccess.user_id == user_id)
                    .filter(Tenant.is_active == True)
                    .order_by(Tenant.id.asc())
                )
                fallback_result = await config_db.execute(fallback_access_stmt)
                fallback_row = fallback_result.first()
                if fallback_row:
                    tenant_url = fallback_row[0]
                    access_role = fallback_row[1]
                    current_tenant_id = fallback_row[2]

            if not tenant_url and settings.PUBLIC_READONLY_ENABLED and is_safe_read:
                public_tenant_stmt = (
                    select(Tenant.db_url)
                    .filter(Tenant.is_active == True)
                    .filter(Tenant.name == settings.PUBLIC_READONLY_TENANT_NAME)
                )
                public_tenant_result = await config_db.execute(public_tenant_stmt)
                tenant_url = public_tenant_result.scalar_one_or_none()

                if not tenant_url:
                    fallback_tenant_result = await config_db.execute(
                        select(Tenant.db_url)
                        .filter(Tenant.is_active == True)
                        .order_by(Tenant.id.asc())
                    )
                    tenant_url = fallback_tenant_result.scalars().first()

                access_role = "VIEWER"
                if tenant_url and request is not None:
                    request.state.sysgrid_public_readonly = True

        if not tenant_url:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"You are not authorized to access SysGrid with user '{user_id}'. "
                    "Contact an administrator for tenant access."
                ),
            )

        normalized_role = (access_role or "VIEWER").upper()
        if not is_safe_read and normalized_role not in {"ADMIN", "EDITOR"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"User '{user_id}' has view-only access. "
                    "Contact an administrator for edit permissions."
                ),
            )

    # 3. Provide session for the target DB
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
            if request is not None:
                request.state.sysgrid_access_role = access_role
                request.state.tenant_id = current_tenant_id # Store tenant ID
            yield session
        finally:
            await session.close()

async def init_config_db():
    from .models.config import ConfigBase, Tenant, MasterSystemSetting
    """Initializes the master configuration database."""
    async with config_engine.begin() as conn:
        await conn.run_sync(ConfigBase.metadata.create_all)
    
    # Seed default data
    async with ConfigSessionLocal() as db:
        # 1. Storage Root
        res = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == "tenant_storage_root"))
        if not res.scalar_one_or_none():
            default_root = settings.TENANT_STORAGE_ROOT
            if not os.path.exists(default_root):
                os.makedirs(default_root, exist_ok=True)
            
            db.add(MasterSystemSetting(
                key="tenant_storage_root",
                value=default_root,
                description="Parent folder on S3 mount where tenant DBs are created"
            ))
            await db.commit()

        # 2. Synchronize the registry entry only if a default tenant already exists.
        res = await db.execute(select(Tenant).filter(Tenant.name == settings.DEFAULT_TENANT_NAME))
        default_tenant = res.scalar_one_or_none()
        if default_tenant and default_tenant.db_url != settings.DATABASE_URL:
            # Synchronize static config with registry if it changed in .env
            default_tenant.db_url = settings.DATABASE_URL
            await db.commit()
            await db.refresh(default_tenant)
