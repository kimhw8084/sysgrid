from logging.config import fileConfig
import sys
import os

# Add the parent directory to sys.path so we can import 'app'
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context
from app.database import Base
from app.models import models

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

def _get_db_url() -> str:
    # Prioritize environment variable for multi-tenant migrations
    env_url = os.getenv("SQLALCHEMY_DATABASE_URL")
    if env_url:
        return env_url.replace("sqlite+aiosqlite", "sqlite")
        
    from app.core.config import settings
    # Use sync driver for Alembic (strip async driver prefix)
    return settings.DATABASE_URL.replace("sqlite+aiosqlite", "sqlite")


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    if not url or url == "driver://user:pass@localhost/dbname":
        url = _get_db_url()
    
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    alembic_config = config.get_section(config.config_ini_section, {})
    if not alembic_config.get("sqlalchemy.url") or alembic_config.get("sqlalchemy.url") == "driver://user:pass@localhost/dbname":
        alembic_config["sqlalchemy.url"] = _get_db_url()

    connectable = engine_from_config(
        alembic_config,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata,
            render_as_batch=True # Important for SQLite
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
