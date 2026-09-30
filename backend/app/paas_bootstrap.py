"""Create a first tenant through the same provisioning path used by the API."""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from starlette.requests import Request

from .api.tenants import create_tenant
from .core.config import settings
from .database import ConfigSessionLocal, init_config_db
from .schemas.config import TenantCreate


async def create_first_tenant() -> None:
    header = settings.TRUSTED_PROXY_USER_HEADER.lower().encode()
    admin = settings.CONTROL_PLANE_ADMIN_USER_IDS.strip()
    request = Request({
        "type": "http", "method": "POST", "path": "/api/v1/tenants/admin/create",
        "headers": [(header, admin.encode())],
    })
    async with ConfigSessionLocal() as db:
        await create_tenant(
            TenantCreate(name="SysGrid", db_name="sysgrid.db"),
            admin, db, request,
        )


def main() -> None:
    settings.assert_production_safe()
    asyncio.run(init_config_db())
    backend_root = Path(__file__).resolve().parents[1]
    command.upgrade(Config(str(backend_root / "alembic.ini")), "head")
    asyncio.run(create_first_tenant())


if __name__ == "__main__":
    main()
