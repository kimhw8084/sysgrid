"""Preview-bound, irreversible Monitoring purge using the existing tenant transaction."""

import hashlib
import json

from fastapi import HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import models
from .operational_bulk import build_operational_bulk_summary, normalize_operational_bulk_ids
from .utils import build_audit_log


DEPENDENCIES = (
    (models.MonitoringOwner, "Monitoring owners", "CASCADE"),
    (models.MonitoringHistory, "Monitoring history", "CASCADE"),
    (models.FarMitigation, "FAR mitigation references", "SET NULL"),
    (models.RcaRecord, "RCA references", "SET NULL"),
)


async def purge_monitoring(request: Request, data: dict, db: AsyncSession) -> dict:
    ids = sorted(normalize_operational_bulk_ids(data.get("ids", [])))
    dry_run = data.get("dry_run", False)
    # A new relationship must be explicitly classified before purge can use it.
    expected = {(model.__tablename__, "monitoring_item_id", effect) for model, _, effect in DEPENDENCIES}
    actual = {
        (table.name, fk.parent.name, fk.ondelete)
        for table in models.MonitoringItem.metadata.tables.values()
        for fk in table.foreign_keys
        if fk.column.table.name == "monitoring_items"
    }
    if actual != expected:
        raise HTTPException(409, "Monitoring dependencies changed; permanent purge is unavailable.")

    try:
        if not dry_run:
            dialect = db.get_bind().dialect.name
            if dialect == "sqlite":
                # SQLite ignores FOR UPDATE. A zero-row write obtains its writer
                # reservation before any impact read, without changing a record.
                # All concurrent dependency writes serialize behind this transaction.
                await db.execute(update(models.MonitoringItem).where(False).values(id=models.MonitoringItem.id))
            elif dialect != "postgresql":
                raise HTTPException(409, "Permanent purge is unavailable for this database engine.")

        query = select(models.MonitoringItem).where(models.MonitoringItem.id.in_(ids)).order_by(models.MonitoringItem.id)
        if not dry_run:
            query = query.with_for_update()
        items = list((await db.execute(query)).scalars().all())
        references = {item.id: {} for item in items}
        for model, _, _ in DEPENDENCIES:
            query = select(model.id, model.monitoring_item_id).where(model.monitoring_item_id.in_(ids)).order_by(model.id)
            if not dry_run:
                query = query.with_for_update()
            for record_id, monitor_id in (await db.execute(query)).all():
                references[monitor_id].setdefault(model.__tablename__, []).append(record_id)

        blockers = [
            {"id": item.id, "reason": "Archive this monitor before permanent purge."}
            for item in items if not (item.is_deleted and item.status == "Deleted")
        ]
        blocked_ids = {entry["id"] for entry in blockers}
        purgeable = [item for item in items if item.id not in blocked_ids]

        def impact_for(selected):
            deletes = [{"table": "monitoring_items", "type": "Monitoring records", "count": len(selected), "disposition": "explicit_delete"}]
            detaches = []
            for model, label, effect in DEPENDENCIES:
                entry = {
                    "table": model.__tablename__, "type": label,
                    "count": sum(len(references[item.id].get(model.__tablename__, [])) for item in selected),
                    "disposition": "database_cascade" if effect == "CASCADE" else "nullified",
                }
                if effect == "CASCADE":
                    deletes.append(entry)
                else:
                    entry["fields"] = ["monitoring_item_id"]
                    detaches.append(entry)
            return {"permanent": True, "recovery_supported": False, "aggregate": {
                "monitoring_count": len(selected),
                "delete_count": sum(entry["count"] for entry in deletes),
                "detach_count": sum(entry["count"] for entry in detaches),
                "deletes": deletes, "detaches": detaches,
            }}

        fingerprint = hashlib.sha256(json.dumps({
            "contract": "monitoring-purge-v1", "tenant": request.state.tenant_id, "ids": ids,
            "items": [{"id": item.id, "version": item.version, "created_at": str(item.created_at),
                       "is_deleted": item.is_deleted, "status": item.status,
                       "references": references[item.id]} for item in items],
        }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        impact = impact_for(purgeable)
        summary = build_operational_bulk_summary(
            action="purge", selected_ids=ids, matched_ids=[item.id for item in items],
            changed_ids=[item.id for item in purgeable], unchanged_ids=[], blockers=blockers,
        )
        preview = {
            **summary, "status": "preview", "selected_ids": ids,
            "matched_ids": [item.id for item in items], "purgeable_ids": [item.id for item in purgeable],
            "versions": {str(item.id): item.version for item in items},
            "precondition": fingerprint, "purge_impact": impact,
            "per_item_impact": {str(item.id): impact_for([item]) for item in purgeable},
            "can_revert": False,
        }
        if dry_run:
            return preview
        supplied = data.get("precondition")
        if not preview["can_execute"] or not isinstance(supplied, str) or supplied != fingerprint:
            raise HTTPException(409, {
                "message": "Purge preview is missing or stale. Nothing was purged. Review a fresh preview.",
                "preview": preview,
            })

        for item in purgeable:
            db.add(build_audit_log(
                request=request, action="PURGE", target_table="monitoring_items", target_id=str(item.id),
                description=f"Permanently purged Monitoring record {item.id}; recovery is unsupported.",
                changes={"id": item.id, "prior_version": item.version,
                         "purge_impact": preview["per_item_impact"][str(item.id)]},
            ))
        # Audit failure must abort before any physical destruction; both still
        # belong to one transaction, including database cascades and SET NULL.
        await db.flush()
        deleted = await db.execute(delete(models.MonitoringItem).where(models.MonitoringItem.id.in_(ids)))
        if deleted.rowcount != len(ids):
            raise HTTPException(409, "Monitoring selection changed; nothing was purged. Preview again.")
        await db.commit()
        return {**preview, "status": "success", "can_execute": False,
                "changed": len(ids), "skipped": 0, "count": len(ids),
                "purge_impact_applied": impact, "summary": f"Permanently purged monitors: {len(ids)}"}
    except Exception:
        await db.rollback()
        raise
