from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..pv1 import communication, domain, models, schemas
from . import pv1
from .module_policy import require_module_access


router = APIRouter(
    tags=["PV1 communication"],
    dependencies=[Depends(require_module_access("projects"))],
)


async def _project(request: Request, db: AsyncSession, project_id: str, *, write: bool = False) -> tuple[models.PV1Project, str]:
    project = await domain.get_pv1_project(db, pv1._tenant_id(request), project_id)
    if not project:
        raise domain.PV1DomainError("NOT_FOUND", "Project not found.", http_status=status.HTTP_404_NOT_FOUND)
    role = await domain.require_project_role(db, tenant_id=project.tenant_id, project_id=project_id, actor_id=pv1._actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), write=write)
    return project, role


def _error(request: Request, error: domain.PV1DomainError) -> JSONResponse:
    return pv1._error(request, error)


def _idempotency(request: Request, header: str | None) -> str:
    return pv1._parse_command_id(header)


async def _execute_command(request: Request, db: AsyncSession, project: models.PV1Project, role: str, command_id: str, command_type: str, expected: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    result = await domain.execute_command(db, tenant_id=project.tenant_id, actor_id=pv1._actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), project_id=project.id, command_id=command_id, command_type=command_type, expected=expected, payload=payload)
    await db.commit()
    return result


@router.get("/projects/{project_id}/resources")
async def list_resources(project_id: str, request: Request, db: AsyncSession = Depends(get_db), search: str | None = None):
    try:
        project, _ = await _project(request, db, project_id)
        statement = select(models.PV1Resource).where(models.PV1Resource.tenant_id == project.tenant_id, models.PV1Resource.project_id == project_id)
        if search:
            statement = statement.where(models.PV1Resource.title.ilike(f"%{search[:80]}%"))
        result = await db.execute(statement.order_by(models.PV1Resource.pinned.desc(), models.PV1Resource.updated_at.desc(), models.PV1Resource.id))
        return {"items": [{"id": item.id, "project_id": item.project_id, "resource_kind": item.resource_kind, "title": item.title, "content": item.content if item.scan_state == "Available" else None, "upload_ref": item.upload_ref if item.scan_state == "Available" else None, "scan_state": item.scan_state, "mime_type": item.mime_type, "size_bytes": item.size_bytes, "sensitivity": item.sensitivity, "pinned": item.pinned, "links": item.links or [], "revision": item.revision} for item in result.scalars()], "source_revision": f"project:{project.revision}"}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.get("/projects/{project_id}/resources/{resource_id}/versions")
async def resource_versions(project_id: str, resource_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        project, _ = await _project(request, db, project_id)
        resource = await db.scalar(select(models.PV1Resource).where(models.PV1Resource.tenant_id == project.tenant_id, models.PV1Resource.project_id == project_id, models.PV1Resource.id == resource_id))
        if not resource:
            raise domain.PV1DomainError("NOT_FOUND", "Resource not found.", http_status=status.HTTP_404_NOT_FOUND)
        result = await db.execute(select(models.PV1ResourceVersion).where(models.PV1ResourceVersion.tenant_id == project.tenant_id, models.PV1ResourceVersion.project_id == project_id, models.PV1ResourceVersion.resource_id == resource_id).order_by(models.PV1ResourceVersion.version.desc()))
        return {"items": [{"id": item.id, "version": item.version, "title": item.title, "content": item.content, "scan_state": item.scan_state, "mime_type": item.mime_type, "size_bytes": item.size_bytes, "created_at": domain._serialize(item.created_at), "created_by": item.created_by} for item in result.scalars()]}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.get("/projects/{project_id}/updates")
async def list_updates(project_id: str, request: Request, db: AsyncSession = Depends(get_db), history: bool = Query(default=False)):
    try:
        project, _ = await _project(request, db, project_id)
        statement = select(models.PV1Update).where(models.PV1Update.tenant_id == project.tenant_id, models.PV1Update.project_id == project_id)
        if not history:
            statement = statement.where(models.PV1Update.state.in_(["Draft", "Published"]))
        result = await db.execute(statement.order_by(models.PV1Update.published_at.desc(), models.PV1Update.updated_at.desc(), models.PV1Update.id))
        return {"items": [communication._update_dict(item) for item in result.scalars()], "source_revision": f"project:{project.revision}"}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.post("/projects/{project_id}/updates/draft")
async def create_update_draft(project_id: str, request: Request, body: dict[str, Any], db: AsyncSession = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    try:
        project, _ = await _project(request, db, project_id, write=True)
        command_id = _idempotency(request, idempotency_key)
        result = await _execute_command(request, db, project, "", command_id, "update.draft", {"project_revision": project.revision}, body)
        return result
    except domain.PV1DomainError as error:
        await db.rollback()
        return _error(request, error)


@router.get("/projects/{project_id}/activity")
async def list_activity(project_id: str, request: Request, db: AsyncSession = Depends(get_db), limit: int = Query(default=50, ge=1, le=200), category: str | None = None, actor_id: str | None = None):
    try:
        project, _ = await _project(request, db, project_id)
        statement = select(models.PV1ActivityProjection).where(models.PV1ActivityProjection.tenant_id == project.tenant_id, models.PV1ActivityProjection.project_id == project_id)
        if category:
            statement = statement.where(models.PV1ActivityProjection.category == category)
        if actor_id:
            statement = statement.where(models.PV1ActivityProjection.actor_id == actor_id)
        result = await db.execute(statement.order_by(models.PV1ActivityProjection.timestamp.desc(), models.PV1ActivityProjection.id.desc()).limit(limit))
        return {"items": [{"id": item.id, "source_event_id": item.source_event_id, "actor_id": item.actor_id, "timestamp": domain._serialize(item.timestamp), "category": item.category, "summary": item.summary, "details": item.details} for item in result.scalars()], "source_revision": f"project:{project.revision}"}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.get("/projects/{project_id}/notifications")
async def list_notifications(project_id: str, request: Request, db: AsyncSession = Depends(get_db), unread_only: bool = False):
    try:
        project, _ = await _project(request, db, project_id)
        statement = select(models.PV1Notification).where(models.PV1Notification.tenant_id == project.tenant_id, models.PV1Notification.project_id == project_id, models.PV1Notification.recipient_id == pv1._actor(request))
        if unread_only:
            statement = statement.where(models.PV1Notification.read_at.is_(None))
        result = await db.execute(statement.order_by(models.PV1Notification.due_at.desc(), models.PV1Notification.id.desc()))
        return {"items": [{"id": item.id, "kind": item.kind, "payload": item.payload, "due_at": domain._serialize(item.due_at), "sent_at": domain._serialize(item.sent_at), "read_at": domain._serialize(item.read_at), "delivery_state": item.delivery_state} for item in result.scalars()]}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.post("/projects/{project_id}/notifications/dispatch")
async def dispatch_notifications(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        project, _ = await _project(request, db, project_id, write=True)
        actor_id = pv1._actor(request)
        result = await db.execute(select(models.PV1Notification).where(models.PV1Notification.tenant_id == project.tenant_id, models.PV1Notification.project_id == project_id, models.PV1Notification.recipient_id == actor_id, models.PV1Notification.delivery_state == "Pending").order_by(models.PV1Notification.due_at, models.PV1Notification.id))
        sent = 0
        for item in result.scalars():
            try:
                await domain.require_project_role(db, tenant_id=project.tenant_id, project_id=project_id, actor_id=actor_id, request_role=getattr(request.state, "sysgrid_access_role", None))
            except domain.PV1DomainError:
                item.delivery_state = "Suppressed"
                continue
            item.delivery_state = "Sent"; item.sent_at = domain._now(); item.attempt_count += 1
            sent += 1
        await db.commit()
        return {"sent": sent, "source_revision": f"project:{project.revision}"}
    except domain.PV1DomainError as error:
        await db.rollback()
        return _error(request, error)


@router.post("/projects/{project_id}/notifications/cadence")
async def queue_cadence_notification(project_id: str, request: Request, body: dict[str, Any] | None = None, db: AsyncSession = Depends(get_db)):
    try:
        project, role = await _project(request, db, project_id, write=True)
        if role not in {"Owner", "Lead", "Tenant administrator"}:
            raise domain.PV1DomainError("FORBIDDEN", "Owner or Lead capability is required to evaluate cadence.", http_status=status.HTTP_403_FORBIDDEN)
        as_of = None
        if body and body.get("as_of"):
            try:
                as_of = datetime.fromisoformat(str(body["as_of"]).replace("Z", "+00:00"))
            except ValueError as exc:
                raise domain.PV1DomainError("VALIDATION_FAILED", "as_of must be an ISO timestamp.") from exc
        queued = await communication.queue_due_cadence_notification(db, project=project, as_of=as_of)
        await db.commit()
        return {"queued": queued, "cadence_kind": project.update_cadence_kind, "weekday": project.update_weekday, "time": project.update_time}
    except domain.PV1DomainError as error:
        await db.rollback()
        return _error(request, error)


@router.post("/projects/{project_id}/reports/capture")
async def capture_report(project_id: str, request: Request, body: dict[str, Any], db: AsyncSession = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    try:
        project, _ = await _project(request, db, project_id, write=True)
        command_id = _idempotency(request, idempotency_key)
        result = await _execute_command(request, db, project, "", command_id, "report.capture", {"project_revision": project.revision}, body)
        return result
    except domain.PV1DomainError as error:
        await db.rollback()
        return _error(request, error)


@router.get("/projects/{project_id}/reports")
async def list_reports(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        project, _ = await _project(request, db, project_id)
        result = await db.execute(select(models.PV1ReportSnapshot).where(models.PV1ReportSnapshot.tenant_id == project.tenant_id, models.PV1ReportSnapshot.project_id == project_id).order_by(models.PV1ReportSnapshot.created_at.desc(), models.PV1ReportSnapshot.id.desc()))
        return {"items": [{"id": item.id, "report_type": item.report_type, "period_start": item.period_start.isoformat(), "period_end": item.period_end.isoformat(), "project_revision": item.project_revision, "source_revisions": item.source_revisions, "confidentiality": item.confidentiality, "author_id": item.author_id, "created_at": domain._serialize(item.created_at)} for item in result.scalars()]}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.get("/projects/{project_id}/reports/{report_id}")
async def get_report(project_id: str, report_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        project, _ = await _project(request, db, project_id)
        report = await db.scalar(select(models.PV1ReportSnapshot).where(models.PV1ReportSnapshot.tenant_id == project.tenant_id, models.PV1ReportSnapshot.project_id == project_id, models.PV1ReportSnapshot.id == report_id))
        if not report:
            raise domain.PV1DomainError("NOT_FOUND", "Report not found.", http_status=status.HTTP_404_NOT_FOUND)
        return {"id": report.id, "report_type": report.report_type, "period_start": report.period_start.isoformat(), "period_end": report.period_end.isoformat(), "project_revision": report.project_revision, "source_revisions": report.source_revisions, "payload": report.payload, "html": report.html, "confidentiality": report.confidentiality, "author_id": report.author_id, "created_at": domain._serialize(report.created_at)}
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.get("/projects/{project_id}/reports/{report_id}/export")
async def export_report(project_id: str, report_id: str, request: Request, db: AsyncSession = Depends(get_db), format: str = Query(default="html")):
    try:
        project, _ = await _project(request, db, project_id)
        report = await db.scalar(select(models.PV1ReportSnapshot).where(models.PV1ReportSnapshot.tenant_id == project.tenant_id, models.PV1ReportSnapshot.project_id == project_id, models.PV1ReportSnapshot.id == report_id))
        if not report:
            raise domain.PV1DomainError("NOT_FOUND", "Report not found.", http_status=status.HTTP_404_NOT_FOUND)
        if format == "html":
            return HTMLResponse(report.html, headers={"Content-Disposition": f'inline; filename="{report.id}.html"'})
        if format == "json":
            return {"report_id": report.id, "project_revision": report.project_revision, "source_revisions": report.source_revisions, "payload": report.payload, "confidentiality": report.confidentiality}
        if format == "pdf":
            lines = [f"{key}: {value}" for key, value in report.payload.items()]
            return Response(communication.minimal_pdf(report.report_type, lines), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{report.id}.pdf"'})
        raise domain.PV1DomainError("VALIDATION_FAILED", "Report export format must be html, json, or pdf.")
    except domain.PV1DomainError as error:
        return _error(request, error)


@router.get("/projects/{project_id}/resources/export")
async def export_resources(project_id: str, request: Request, db: AsyncSession = Depends(get_db), format: str = Query(default="json")):
    try:
        project, _ = await _project(request, db, project_id)
        result = await db.execute(select(models.PV1Resource).where(models.PV1Resource.tenant_id == project.tenant_id, models.PV1Resource.project_id == project_id).order_by(models.PV1Resource.title, models.PV1Resource.id))
        resources = [item for item in result.scalars() if item.scan_state == "Available"]
        rows = [{"id": item.id, "title": item.title, "resource_kind": item.resource_kind, "content": item.content or "", "scan_state": item.scan_state, "revision": item.revision} for item in resources]
        source = {"project_revision": project.revision, "captured_at": domain._now().isoformat(), "confidentiality": project.visibility}
        if format == "json":
            return {"source": source, "resources": rows}
        if format == "csv":
            return Response(communication.csv_export(rows, ["id", "title", "resource_kind", "content", "scan_state", "revision"]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{project_id}-resources.csv"'})
        if format == "markdown":
            text = f"# {project.name} resources\n\nSource project revision: {project.revision}\n\n" + "\n\n".join(f"## {communication.sanitize_markdown(item['title'])}\n\n{communication.sanitize_markdown(item['content'])}" for item in rows)
            return Response(text, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{project_id}-resources.md"'})
        raise domain.PV1DomainError("VALIDATION_FAILED", "Resource export format must be json, csv, or markdown.")
    except domain.PV1DomainError as error:
        return _error(request, error)
