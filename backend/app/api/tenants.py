from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import select, update, insert, func, text, create_engine
from typing import List, Optional
import os
import sys
import subprocess
from ..database import get_config_db, get_db, ConfigSessionLocal, get_tenant_engine, is_sqlite_url, sqlite_path_from_url
from ..models.config import Tenant, UserTenantAccess, MasterSystemSetting
from ..schemas.config import TenantCreate, TenantResponse, MasterSettingBase, UserTenantSelection, UserTenantResponse, TenantAttach, PreflightRequest, PreflightResponse
from ..core.config import settings
from .authorization import require_control_plane_admin
from .utils import get_current_user_id

router = APIRouter(prefix="/tenants", tags=["Multi-Tenancy"])

def normalize_fs_path(path: str) -> str:
    return os.path.abspath(os.path.expanduser(path))

def path_is_within(base: str, candidate: str) -> bool:
    try:
        return os.path.commonpath([base, candidate]) == base
    except ValueError:
        return False

def get_storage_explorer_roots(extra_root: Optional[str] = None) -> list[str]:
    candidates = [
        extra_root,
        settings.TENANT_STORAGE_ROOT,
        os.getcwd(),
        os.path.expanduser("~"),
        "/",
    ]
    roots: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        normalized = normalize_fs_path(candidate)
        if normalized not in roots and os.path.exists(normalized):
            roots.append(normalized)
    return roots

def resolve_db_target(db_path: str | None = None, db_url: str | None = None) -> tuple[str, str]:
    if db_url and db_url.strip():
        return db_url.strip(), "Database URL"
    if db_path and db_path.strip():
        normalized_path = db_path.strip()
        if not os.path.isabs(normalized_path):
            normalized_path = os.path.abspath(os.path.join(settings.TENANT_STORAGE_ROOT, normalized_path))
        return f"sqlite+aiosqlite:///{normalized_path}", "Database Path"
    raise HTTPException(status_code=400, detail="Either db_path or db_url must be provided")


def sanitize_db_filename(raw_name: str) -> str:
    cleaned = (raw_name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Database file name cannot be empty")
    stem, ext = os.path.splitext(cleaned)
    base_name = stem if ext.lower() == ".db" else cleaned
    safe_base = "".join(ch for ch in base_name if ch.isalnum() or ch in {"_", "-"}).strip("._-").lower()
    if not safe_base:
        raise HTTPException(status_code=400, detail="Database file name contains no valid characters")
    return f"{safe_base}.db"


def resolve_parent_folder(storage_root: str, parent_folder: str | None) -> str:
    base_root = normalize_fs_path(storage_root)
    if not parent_folder or not parent_folder.strip():
        return base_root
    requested = parent_folder.strip()
    resolved = normalize_fs_path(requested if os.path.isabs(requested) else os.path.join(base_root, requested))
    return resolved

async def tenant_online_status(db_url: str) -> bool:
    if is_sqlite_url(db_url):
        db_path = sqlite_path_from_url(db_url)
        return bool(db_path and os.path.exists(db_path))

    engine = get_tenant_engine(db_url)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def set_user_selected_tenant(db: AsyncSession, user_id: str, tenant_id: int) -> None:
    await db.execute(update(UserTenantAccess).where(UserTenantAccess.user_id == user_id).values(is_selected=False))
    result = await db.execute(
        select(UserTenantAccess)
        .filter(UserTenantAccess.user_id == user_id, UserTenantAccess.tenant_id == tenant_id)
    )
    access = result.scalar_one_or_none()
    if access:
        access.is_selected = True


async def grant_tenant_access(
    db: AsyncSession,
    *,
    user_id: str,
    tenant_id: int,
    role: str,
    make_selected: bool = False,
) -> UserTenantAccess:
    result = await db.execute(
        select(UserTenantAccess)
        .filter(UserTenantAccess.user_id == user_id, UserTenantAccess.tenant_id == tenant_id)
    )
    access = result.scalar_one_or_none()
    if access:
        access.role = role
    else:
        access = UserTenantAccess(user_id=user_id, tenant_id=tenant_id, role=role, is_selected=False)
        db.add(access)
        await db.flush()

    if make_selected:
        await set_user_selected_tenant(db, user_id, tenant_id)
    return access


def serialize_tenant_response(
    tenant: Tenant,
    *,
    is_online: bool = True,
    last_backup=None,
) -> TenantResponse:
    return TenantResponse.model_validate({
        "id": tenant.id,
        "name": tenant.name,
        "db_url": tenant.db_url,
        "is_active": bool(tenant.is_active),
        "is_online": is_online,
        "last_backup": last_backup,
        "created_at": tenant.created_at,
    })

@router.get("/admin/settings", response_model=List[MasterSettingBase])
async def get_master_settings(
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
):
    result = await db.execute(select(MasterSystemSetting))
    return result.scalars().all()

@router.post("/admin/settings", response_model=MasterSettingBase)
async def update_master_setting(
    setting: MasterSettingBase,
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
):
    # Verify path if key is tenant_storage_root
    if setting.key == "tenant_storage_root":
        if not os.path.exists(setting.value):
            try:
                os.makedirs(setting.value, exist_ok=True)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Cannot create or access storage path: {str(e)}")
        
        # Test write permission
        test_file = os.path.join(setting.value, ".write_test")
        try:
            with open(test_file, "w") as f:
                f.write("test")
            os.remove(test_file)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Storage path is not writable: {str(e)}")

    existing_res = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == setting.key))
    existing = existing_res.scalar_one_or_none()
    if existing:
        existing.value = setting.value
        existing.description = setting.description
    else:
        db.add(MasterSystemSetting(
            key=setting.key,
            value=setting.value,
            description=setting.description,
        ))
    await db.commit()
    
    result = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == setting.key))
    return result.scalar_one()

@router.get("/admin/storage-explorer")
async def browse_storage_locations(
    path: Optional[str] = Query(default=None),
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
    request: Request = None,
):
    # Fetch current storage root from DB to ensure it's always considered a root
    res = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == "tenant_storage_root"))
    db_root_setting = res.scalar_one_or_none()
    db_root = db_root_setting.value if db_root_setting else None

    roots = [normalize_fs_path(r) for r in get_storage_explorer_roots(db_root)]
    requested_path = normalize_fs_path(path) if path else (normalize_fs_path(db_root) if db_root else normalize_fs_path(settings.TENANT_STORAGE_ROOT or os.getcwd()))

    if not any(path_is_within(root, requested_path) or requested_path == root for root in roots):
        raise HTTPException(status_code=400, detail="Requested path is outside the accessible explorer roots")
    if not os.path.exists(requested_path):
        raise HTTPException(status_code=404, detail="Requested path was not found")
    if not os.path.isdir(requested_path):
        raise HTTPException(status_code=400, detail="Requested path is not a directory")

    def access_flags(target: str):
        return {
            "readable": os.access(target, os.R_OK),
            "writable": os.access(target, os.W_OK),
        }

    try:
        entries = []
        for name in sorted(os.listdir(requested_path), key=lambda item: item.lower()):
            if name.startswith("."):
                continue
            full_path = os.path.join(requested_path, name)
            if not os.path.isdir(full_path):
                continue
            stats = access_flags(full_path)
            entries.append({
                "name": name,
                "path": full_path,
                "readable": stats["readable"],
                "writable": stats["writable"],
            })
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Cannot read directory contents: {exc}")

    parent_path = os.path.dirname(requested_path.rstrip(os.sep)) or os.sep
    if requested_path == os.sep or not any(path_is_within(root, parent_path) or parent_path == root for root in roots):
        parent_path = None

    return {
        "current_path": requested_path,
        "parent_path": parent_path,
        "roots": [
            {
                "label": (
                    "Tenant storage root" if root == normalize_fs_path(settings.TENANT_STORAGE_ROOT)
                    else "Workspace" if root == normalize_fs_path(os.getcwd())
                    else "Home" if root == normalize_fs_path(os.path.expanduser("~"))
                    else "Filesystem root"
                ),
                "path": root,
                **access_flags(root),
            }
            for root in roots
        ],
        "entries": entries,
        "current_access": access_flags(requested_path),
        "runtime_context": {
            "workspace_root": normalize_fs_path(os.getcwd()),
            "tenant_storage_root": normalize_fs_path(settings.TENANT_STORAGE_ROOT),
            "process_user": get_current_user_id(request) if request else None,
        },
    }

@router.post("/admin/backup/{tenant_id}")
async def backup_tenant(
    tenant_id: int,
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
):
    """Triggers a manual backup of the tenant database."""
    res = await db.execute(select(Tenant).filter(Tenant.id == tenant_id))
    tenant = res.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")
    
    # Get storage root
    res_root = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == "tenant_storage_root"))
    storage_root = res_root.scalar_one().value
    
    if not is_sqlite_url(tenant.db_url):
        raise HTTPException(status_code=400, detail="Manual backup is currently supported only for SQLite tenant databases.")

    backup_dir = os.path.join(storage_root, "backups", tenant.name.lower().replace(" ", "_"))
    os.makedirs(backup_dir, exist_ok=True)
    
    # Source path
    db_path = sqlite_path_from_url(tenant.db_url)
    if not os.path.exists(db_path):
        raise HTTPException(400, "Source database file not found")
        
    # Destination path
    import datetime
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_dir, f"backup_{timestamp}.db")
    
    # We use VACUUM INTO for a safe, consistent online backup if possible
    # But since we are using aiosqlite, we can trigger this via a session
    tenant_engine = get_tenant_engine(tenant.db_url)
    session_factory = async_sessionmaker(bind=tenant_engine, class_=AsyncSession)
    
    try:
        async with session_factory() as tenant_db:
            # SQLite safe backup command
            await tenant_db.execute(text(f"VACUUM INTO '{backup_path}'"))
        return {"status": "success", "path": backup_path}
    except Exception as e:
        # Fallback to simple copy if VACUUM INTO fails (e.g. older sqlite)
        import shutil
        try:
            shutil.copy2(db_path, backup_path)
            return {"status": "success", "path": backup_path, "note": "fallback copy used"}
        except Exception as copy_err:
            raise HTTPException(500, detail=f"Backup failed: {str(e)} | Fallback failed: {str(copy_err)}")

@router.get("/admin/all", response_model=List[TenantResponse])
async def list_all_tenants(
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
):
    result = await db.execute(select(Tenant))
    tenants = result.scalars().all()
    
    # Get storage root to check for backups
    res_root = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == "tenant_storage_root"))
    storage_root = res_root.scalar_one().value
    
    # Enrich with backup info and actual disk status
    enriched = []
    for t in tenants:
        is_online = await tenant_online_status(t.db_url)
        
        # Check last backup
        last_backup = None
        backup_dir = os.path.join(storage_root, "backups", t.name.lower().replace(" ", "_"))
        if os.path.exists(backup_dir):
            backups = sorted([f for f in os.listdir(backup_dir) if f.endswith(".db")], reverse=True)
            if backups:
                # Extract timestamp from backup_YYYYMMDD_HHMMSS.db
                import datetime
                try:
                    ts_str = backups[0].replace("backup_", "").replace(".db", "")
                    last_backup = datetime.datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
                except:
                    pass
        
        # We need to manually construct the response object because TenantResponse doesn't have is_online
        # Wait, TenantResponse has is_active but that's a DB field. Let's add is_online and last_backup to schema.
        enriched.append({
            "id": t.id,
            "name": t.name,
            "db_url": t.db_url,
            "is_active": t.is_active,
            "is_online": is_online,
            "last_backup": last_backup,
            "created_at": t.created_at
        })
    return enriched

import asyncio

def run_alembic_upgrade(db_url: str):
    """Runs alembic upgrade head on a specific database file non-blockingly."""
    # Convert async url to sync for alembic
    # sqlite+aiosqlite:///path -> sqlite:///path
    sync_url = db_url.replace("sqlite+aiosqlite", "sqlite")
    
    # CORRECT PATH: tenants.py is in backend/app/api/, so we need to go 3 levels up to reach backend/
    api_dir = os.path.dirname(os.path.abspath(__file__))
    app_dir = os.path.dirname(api_dir)
    backend_dir = os.path.dirname(app_dir)
    
    env = os.environ.copy()
    env["SQLALCHEMY_DATABASE_URL"] = sync_url

    alembic_runner = os.path.abspath(os.path.join(backend_dir, "..", "scripts", "run-alembic.py"))
    process = subprocess.run(
        [sys.executable, alembic_runner, "upgrade", "head"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True
    )

    if process.returncode != 0:
        error_msg = process.stderr
        print(f"ALEMBIC ERROR: {error_msg}")
        return False, error_msg
    return True, process.stdout


async def ensure_tenant_runtime_schema(db_url: str) -> None:
    """Repair and verify tenant schema pieces that the live app requires immediately."""
    engine = create_async_engine(db_url, future=True)
    compatibility_columns = {
        "far_failure_modes": {
            "version": "INTEGER DEFAULT 1",
        },
        "far_resolutions": {
            "guidance_notes": "TEXT",
        },
        "rca_records": {
            "version": "INTEGER DEFAULT 1",
        },
    }
    required_tables = {
        "far_history": """
            CREATE TABLE IF NOT EXISTS far_history (
                far_mode_id INTEGER,
                version INTEGER,
                snapshot JSON,
                change_summary TEXT,
                id INTEGER NOT NULL PRIMARY KEY,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by_user_id VARCHAR,
                UNIQUE (far_mode_id, version),
                FOREIGN KEY(far_mode_id) REFERENCES far_failure_modes (id) ON DELETE CASCADE
            )
        """,
        "rca_history": """
            CREATE TABLE IF NOT EXISTS rca_history (
                rca_id INTEGER,
                version INTEGER,
                snapshot JSON,
                change_summary TEXT,
                id INTEGER NOT NULL PRIMARY KEY,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by_user_id VARCHAR,
                UNIQUE (rca_id, version),
                FOREIGN KEY(rca_id) REFERENCES rca_records (id) ON DELETE CASCADE
            )
        """,
    }
    async with engine.begin() as conn:
        for table_name, ddl in required_tables.items():
            await conn.execute(text(ddl))
            await conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table_name}_id ON {table_name} (id)"))

        for table_name, columns in compatibility_columns.items():
            existing = {
                row[1]
                for row in (await conn.execute(text(f"PRAGMA table_info({table_name})"))).fetchall()
            }
            for column_name, column_ddl in columns.items():
                if column_name not in existing:
                    await conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl} DEFAULT 1"))

        await conn.execute(text("UPDATE far_failure_modes SET version = 1 WHERE version IS NULL"))
        await conn.execute(text("UPDATE rca_records SET version = 1 WHERE version IS NULL"))

@router.post("/admin/create", response_model=TenantResponse)
async def create_tenant(
    tenant_in: TenantCreate,
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
    request: Request = None,
):
    # 1. Get storage root
    res = await db.execute(select(MasterSystemSetting).filter(MasterSystemSetting.key == "tenant_storage_root"))
    storage_root_setting = res.scalar_one_or_none()
    storage_root = storage_root_setting.value if storage_root_setting else settings.TENANT_STORAGE_ROOT
    
    storage_root = normalize_fs_path(storage_root)
    parent_folder = resolve_parent_folder(storage_root, tenant_in.parent_folder)

    # Ensure root exists
    if not os.path.exists(parent_folder):
        try:
            os.makedirs(parent_folder, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create tenant parent folder: {str(e)}")
    
    # Case-insensitive check and filename normalization
    import re
    tenant_name_clean = tenant_in.name.strip()
    if not tenant_name_clean:
        raise HTTPException(status_code=400, detail="Tenant name cannot be empty")
        
    # Sanitize for filesystem safety and prevent path traversal
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', tenant_name_clean.replace(' ', '_')).lower()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Tenant name contains no valid characters for database identification")
        
    requested_db_name = tenant_in.db_name or safe_name
    db_filename = sanitize_db_filename(requested_db_name)
    db_path = os.path.join(parent_folder, db_filename)
    db_url = f"sqlite+aiosqlite:///{db_path}"

    # 2. Check if already exists (Case Insensitive)
    res = await db.execute(select(Tenant).filter(func.lower(Tenant.name) == tenant_name_clean.lower()))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Tenant name already exists")
    
    if os.path.exists(db_path):
        raise HTTPException(status_code=400, detail="Database file already exists on disk. Please use a unique name.")

    # 3. Create file and run migrations
    success, error = run_alembic_upgrade(db_url)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to initialize database: {error}")
    await ensure_tenant_runtime_schema(db_url)

    # 4. Register in config.db
    new_tenant = Tenant(name=tenant_name_clean, db_url=db_url)
    db.add(new_tenant)
    await db.flush()

    # 5. Auto-grant access to the creator and ensure they are an admin in the tenant DB
    user_id = get_current_user_id(request)
    await grant_tenant_access(db, user_id=user_id, tenant_id=new_tenant.id, role="ADMIN", make_selected=True)
    
    # NEW: Ensure the operator exists in the tenant's own database as an admin
    from ..api.settings import ensure_tenant_admin_async
    await ensure_tenant_admin_async(
        tenant_db_url=db_url,
        admin_user=user_id,
        full_name=None,
        email=None,
        department="Administrative"
    )
    
    await db.commit()

    await db.refresh(new_tenant)
    return serialize_tenant_response(new_tenant, is_online=await tenant_online_status(new_tenant.db_url))

@router.post("/admin/preflight", response_model=PreflightResponse)
async def preflight_check(
    req: PreflightRequest,
    _control_plane_admin: str = Depends(require_control_plane_admin),
):
    """
    Checks if a database file exists and validates its schema compatibility.
    """
    db_url, target_kind = resolve_db_target(req.db_path, req.db_url)
    if is_sqlite_url(db_url):
        db_path = sqlite_path_from_url(db_url)
        if not db_path or not os.path.exists(db_path):
            return {
                "status": "Error",
                "is_valid": False,
                "table_count": 0,
                "message": f"File not found: {db_path}",
                "target": target_kind
            }

    engine = get_tenant_engine(db_url)
    
    try:
        async with engine.connect() as conn:
            # 1. Check table count
            res = await conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table'"))
            table_count = res.scalar()
            
            # 2. Check for alembic_version
            res = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'"))
            has_alembic = res.scalar_one_or_none()
            
            schema_version = "Unknown"
            if has_alembic:
                res = await conn.execute(text("SELECT version_num FROM alembic_version"))
                schema_version = res.scalar()
            
            # 3. Check for core tables
            res = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'"))
            has_devices = res.scalar_one_or_none()
            
            if not has_devices and table_count > 0:
                return {
                    "status": "Incompatible",
                    "is_valid": False,
                    "schema_version": schema_version,
                    "table_count": table_count,
                    "message": "Database exists but missing core SysGrid tables (e.g. 'devices').",
                    "target": target_kind
                }
                
            return {
                "status": "Healthy" if has_devices else "Empty",
                "is_valid": True,
                "schema_version": schema_version,
                "table_count": table_count,
                "message": "Database is compatible and ready to be linked." if has_devices else "Database is empty but valid for initialization.",
                "target": target_kind
            }
    except Exception as e:
        return {
            "status": "Corrupt",
            "is_valid": False,
            "table_count": 0,
            "message": f"Connection failed: {str(e)}",
            "target": target_kind
        }

@router.post("/admin/attach", response_model=TenantResponse)
async def attach_tenant(
    tenant_in: TenantAttach,
    _control_plane_admin: str = Depends(require_control_plane_admin),
    db: AsyncSession = Depends(get_config_db),
    request: Request = None,
):
    """
    Links an existing database file on disk to the registry.
    """
    tenant_name_clean = (tenant_in.name or "").strip()
    if not tenant_name_clean:
        raise HTTPException(status_code=400, detail="Tenant name cannot be empty")

    db_url, _ = resolve_db_target(tenant_in.db_path, tenant_in.db_url)
    if is_sqlite_url(db_url):
        db_path = sqlite_path_from_url(db_url)
        if not db_path or not os.path.exists(db_path):
            raise HTTPException(status_code=400, detail=f"Database file not found: {db_path}")
    
    # 1. Check if already exists in registry
    res = await db.execute(select(Tenant).filter(func.lower(Tenant.name) == tenant_name_clean.lower()))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Tenant name already exists in registry")
        
    res = await db.execute(select(Tenant).filter(Tenant.db_url == db_url))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This database path is already registered under a different name")

    # 2. Run migrations (idempotent) to ensure it's up to date
    success, error = run_alembic_upgrade(db_url)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to synchronize schema: {error}")
    await ensure_tenant_runtime_schema(db_url)

    # 3. Register
    new_tenant = Tenant(name=tenant_name_clean, db_url=db_url)
    db.add(new_tenant)
    await db.flush()

    # 4. Grant access
    user_id = get_current_user_id(request)
    await grant_tenant_access(db, user_id=user_id, tenant_id=new_tenant.id, role="ADMIN", make_selected=True)
    
    # NEW: Ensure the operator exists in the tenant's own database as an admin
    from ..api.settings import ensure_tenant_admin_async
    await ensure_tenant_admin_async(
        tenant_db_url=db_url,
        admin_user=user_id,
        full_name=None,
        email=None,
        department="Administrative"
    )
    
    await db.commit()

    await db.refresh(new_tenant)
    return serialize_tenant_response(new_tenant, is_online=await tenant_online_status(new_tenant.db_url))

@router.get("/me", response_model=List[UserTenantResponse])
async def get_my_tenants(db: AsyncSession = Depends(get_config_db), request: Request = None):
    user_id = get_current_user_id(request)

    stmt = (
        select(Tenant.id, Tenant.name, UserTenantAccess.role, UserTenantAccess.is_selected, Tenant.db_url)
        .join(UserTenantAccess)
        .filter(UserTenantAccess.user_id == user_id)
        .filter(Tenant.is_active == True)
    )
    result = await db.execute(stmt)
    
    my_tenants = []
    for r in result.all():
        is_online = await tenant_online_status(r[4])
        my_tenants.append({
            "id": r[0], 
            "name": r[1], 
            "role": r[2], 
            "is_selected": r[3],
            "is_online": is_online,
            "db_url": r[4],
        })
    return my_tenants

@router.post("/select")
async def select_tenant(selection: UserTenantSelection, db: AsyncSession = Depends(get_config_db), request: Request = None):
    user_id = get_current_user_id(request)
    
    # Verify access
    res = await db.execute(
        select(UserTenantAccess)
        .join(Tenant, Tenant.id == UserTenantAccess.tenant_id)
        .filter(
            UserTenantAccess.user_id == user_id,
            UserTenantAccess.tenant_id == selection.tenant_id,
            Tenant.is_active == True,
        )
    )
    access = res.scalar_one_or_none()
    if not access:
        raise HTTPException(status_code=403, detail="Access denied to this tenant")

    # Update selection
    await set_user_selected_tenant(db, user_id, selection.tenant_id)
    await db.commit()
    
    return {"status": "success", "tenant_id": selection.tenant_id}
