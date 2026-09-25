"""Explicit operator-run schema operations used by production data drills."""
from __future__ import annotations

import asyncio

from .database import config_engine, create_config_schema


async def create_config_schema_only() -> None:
    await create_config_schema()


async def main() -> None:
    try:
        await create_config_schema_only()
    finally:
        await config_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
