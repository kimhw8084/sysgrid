#!/usr/bin/env python3
"""Create one disposable FAR risk projection for an isolated Assets fixture."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR / "backend"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--device-id", required=True, type=int)
    parser.add_argument("--system-name", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--created-by", required=True)
    args = parser.parse_args()

    database_url = f"sqlite:///{Path(args.db_path).resolve()}"
    os.environ["DATABASE_URL"] = database_url
    os.environ["SQLALCHEMY_DATABASE_URL"] = database_url
    os.environ.setdefault("TENANT_STORAGE_ROOT", str(Path(args.db_path).resolve().parent / "tenants"))
    os.environ.setdefault("DEFAULT_USER_ID", args.created_by)
    os.environ.setdefault("DEFAULT_EMAIL_DOMAIN", "sysgrid.test")
    os.environ.setdefault("ENVIRONMENT", "development")

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.models import models

    engine = create_engine(database_url, future=True)
    with Session(engine) as session:
        mode = models.FarFailureMode(
            system_name=args.system_name,
            failure_type="Design",
            title=args.title,
            effect="Simulated embedded risk summary",
            severity=8,
            occurrence=4,
            detection=3,
            rpn=96,
            status="Analyzing",
            is_deleted=False,
            version=1,
            created_by_user_id=args.created_by,
        )
        session.add(mode)
        session.flush()
        session.execute(models.far_mode_assets.insert().values(mode_id=mode.id, device_id=args.device_id))
        session.commit()
        print(json.dumps({"id": mode.id, "title": mode.title, "system_name": mode.system_name}))


if __name__ == "__main__":
    main()
