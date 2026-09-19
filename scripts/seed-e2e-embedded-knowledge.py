#!/usr/bin/env python3
"""Create one read-only embedded Knowledge projection for an isolated E2E fixture.

The normal-v1 browser identity cannot POST the preview Knowledge module. This
fixture command writes only disposable test data, after the owned runtime has
created the tenant database; browser/API authorization remains unchanged.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--device-id", required=True, type=int)
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

    metadata = {
        "entry_type": "Runbook",
        "criticality": "Standard",
        "ownership": {"owner": args.created_by, "backup_owner": "", "review_team": "", "escalation_contact": ""},
        "verification": {"state": "Needs Review", "last_verified_at": "", "next_review_at": "", "verified_by": ""},
        "links": {
            "data_flow_ids": [], "service_ids": [], "monitoring_ids": [], "far_ids": [],
            "research_ids": [], "vendor_ids": [], "project_ids": [],
        },
        "feedback": [],
        "version_history": [{
            "version": 1,
            "changed_at": datetime.now(timezone.utc).isoformat(),
            "changed_by": args.created_by,
            "summary": "Embedded E2E fixture",
        }],
        "source_context": {"fixture": "sysgrid-smv1-qualification-completion-fix-v5"},
    }

    engine = create_engine(database_url, future=True)
    with Session(engine) as session:
        entry = models.KnowledgeEntry(
            category="BKM",
            title=args.title,
            content="Recovery procedure",
            content_json={},
            tags=["Playwright"],
            linked_device_ids=[args.device_id],
            status="Published",
            is_deleted=False,
            metadata_json=metadata,
            created_by_user_id=args.created_by,
        )
        session.add(entry)
        session.commit()
        session.refresh(entry)
        print(json.dumps({
            "id": entry.id,
            "title": entry.title,
            "category": entry.category,
            "content": entry.content,
        }))


if __name__ == "__main__":
    main()
