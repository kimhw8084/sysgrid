from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime
from uuid import uuid4
from ..database import get_db
from ..models import models
from ..schemas import schemas
from ..pv1 import domain as pv1_domain
from ..pv1 import migration as pv1_migration
from ..pv1 import models as pv1_models
from .utils import filter_valid_columns, get_current_user_id
from .project_hierarchy import validate_project_parent_assignment
from .module_policy import require_module_access

router = APIRouter(
    prefix="/projects",
    tags=["Projects"],
    dependencies=[Depends(require_module_access("projects"))],
)

async def _cutover(request: Request, db: AsyncSession):
    tenant_id = getattr(request.state, "tenant_id", None)
    if not isinstance(tenant_id, int):
        return None
    return await pv1_migration.get_tenant_cutover(db, tenant_id)


def _legacy_writes_closed(cutover: pv1_models.PV1TenantCutover | None) -> bool:
    return cutover is not None and cutover.state in {"cutover", "read_only"}


def _cutover_write_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "LEGACY_WRITE_REQUIRES_PV1_COMMAND",
            "message": "This tenant has cut over to PV1. Use the v2 command endpoint; the v1 route is read-compatible only.",
        },
    )


async def _canonical_v1_update(project_id: int, data: schemas.ProjectUpdate, request: Request, db: AsyncSession):
    tenant_id = getattr(request.state, "tenant_id", None)
    actor_id = get_current_user_id(request)
    request_role = getattr(request.state, "sysgrid_access_role", None)
    canonical = await pv1_domain.get_pv1_project(db, tenant_id, str(project_id))
    if canonical is None:
        raise HTTPException(status_code=404, detail="Project not found")
    await pv1_domain.require_project_role(db, tenant_id=tenant_id, project_id=str(project_id), actor_id=actor_id, request_role=request_role, write=True)
    values = data.model_dump(exclude_unset=True)
    tasks_data = values.pop("tasks", None)
    unsupported = set(values) - {"name", "objective", "problem_statement", "description", "priority", "start_date", "end_date", "timezone", "status"}
    if unsupported:
        raise _cutover_write_error()
    if "status" in values and values["status"] != pv1_migration._compat_status(canonical):
        raise _cutover_write_error()
    patch = {}
    for source, target in (("name", "name"), ("objective", "objective"), ("priority", "priority"), ("timezone", "timezone")):
        if source in values:
            patch[target] = values[source]
    if "problem_statement" in values:
        patch["problem"] = values["problem_statement"]
    elif "description" in values:
        patch["problem"] = values["description"]
    if "start_date" in values:
        patch["start_date"] = values["start_date"].date().isoformat() if isinstance(values["start_date"], datetime) else values["start_date"]
    if "end_date" in values:
        patch["target_date"] = values["end_date"].date().isoformat() if isinstance(values["end_date"], datetime) else values["end_date"]
    if patch:
        await pv1_domain.execute_command(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            request_role=request_role,
            project_id=str(project_id),
            command_id=str(uuid4()),
            command_type="project.update_details",
            expected={"project_revision": canonical.revision},
            payload=patch,
        )
        await db.refresh(canonical)
    if tasks_data is not None:
        for task_data in tasks_data:
            if not task_data.get("id"):
                raise _cutover_write_error()
            task_id = str(task_data["id"])
            task = await db.scalar(select(pv1_models.PV1Task).where(
                pv1_models.PV1Task.tenant_id == tenant_id,
                pv1_models.PV1Task.project_id == str(project_id),
                (pv1_models.PV1Task.legacy_task_id == int(task_id) if task_id.isdigit() else pv1_models.PV1Task.id == task_id),
            ))
            if task is None:
                raise HTTPException(status_code=404, detail="Task not found")
            task_patch = {}
            for source, target in (("name", "title"), ("description", "description"), ("owner", "owner_id"), ("priority", "priority"), ("progress", "progress")):
                if source in task_data:
                    task_patch[target] = task_data[source]
            if "status" in task_data and task_data["status"] not in {"Done", "Completed", task.status}:
                raise _cutover_write_error()
            current_project = await pv1_domain.get_pv1_project(db, tenant_id, str(project_id))
            if task_patch:
                await pv1_domain.execute_command(
                    db,
                    tenant_id=tenant_id,
                    actor_id=actor_id,
                    request_role=request_role,
                    project_id=str(project_id),
                    command_id=str(uuid4()),
                    command_type="task.update_fields",
                    expected={"project_revision": current_project.revision, "graph_revision": current_project.graph_revision, "task_revision": task.revision},
                    payload={"task_id": task.id, **task_patch},
                )
                await db.refresh(task)
    await db.commit()
    canonical = await pv1_domain.get_pv1_project(db, tenant_id, str(project_id))
    await db.refresh(canonical)
    return await pv1_migration.canonical_project_legacy_response(db, canonical)


@router.get("", response_model=List[schemas.ProjectResponse])
async def get_projects(request: Request, include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    cutover = await _cutover(request, db)
    if cutover and cutover.state in {"cutover", "read_only"}:
        statement = select(pv1_models.PV1Project).where(pv1_models.PV1Project.tenant_id == request.state.tenant_id)
        if not include_deleted:
            statement = statement.where(pv1_models.PV1Project.archived_at.is_(None))
        result = await db.execute(statement.order_by(pv1_models.PV1Project.display_key))
        return [await pv1_migration.canonical_project_legacy_response(db, project) for project in result.scalars()]
    query = select(models.Project).options(
        selectinload(models.Project.tasks).selectinload(models.ProjectTask.subtasks),
        selectinload(models.Project.tasks).selectinload(models.ProjectTask.comments),
        selectinload(models.Project.tasks).selectinload(models.ProjectTask.qa_items),
        selectinload(models.Project.comments),
        selectinload(models.Project.qa_items)
    ).order_by(models.Project.order_index.asc(), models.Project.created_at.desc())
    if not include_deleted:
        query = query.filter(models.Project.is_deleted == False)
    
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/reorder")
async def reorder_projects(order_data: List[dict], request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    # Expected format: [{"id": 1, "order_index": 0}, {"id": 2, "order_index": 1}]
    for item in order_data:
        if "id" in item and "order_index" in item:
            await db.execute(
                update(models.Project)
                .where(models.Project.id == item["id"])
                .values(order_index=item["order_index"])
            )
    await db.commit()
    return {"message": "Order updated successfully"}

@router.post("", response_model=schemas.ProjectResponse)
async def create_project(data: schemas.ProjectCreate, request: Request, db: AsyncSession = Depends(get_db)):
    cutover = await _cutover(request, db)
    if cutover and cutover.state == "cutover":
        actor_id = get_current_user_id(request)
        status_value = (data.status or "Planning").strip()
        phase = {"Not Started": "Proposed", "Planning": "Planning"}.get(status_value, "Draft")
        requested_owner = (data.owner or "").strip()
        request_role = getattr(request.state, "sysgrid_access_role", None)
        if requested_owner and requested_owner != actor_id and request_role != "ADMIN":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Legacy compatibility cannot assign an unverified browser identity as project owner.")
        payload = {
            "name": data.name,
            "objective": data.objective,
            "problem": data.problem_statement or data.description,
            "team_id": data.team_id,
            "owner_id": requested_owner or actor_id,
            "template_key": data.type,
            "phase": phase,
            "priority": "Critical" if data.priority == "Highest" else data.priority,
            "start_date": data.start_date.date().isoformat() if isinstance(data.start_date, datetime) else data.start_date,
            "target_date": data.end_date.date().isoformat() if isinstance(data.end_date, datetime) else data.end_date,
        }
        result = await pv1_domain.create_project(db, tenant_id=request.state.tenant_id, actor_id=actor_id, request_role=request_role, command_id=str(uuid4()), payload=payload)
        await db.commit()
        canonical = await pv1_domain.get_pv1_project(db, request.state.tenant_id, result["changed_entities"][0]["id"])
        return await pv1_migration.canonical_project_legacy_response(db, canonical)
    project_data = data.model_dump()
    tasks_data = project_data.pop("tasks", [])
    await validate_project_parent_assignment(
        db,
        project_id=None,
        parent_project_id=project_data.get("parent_project_id"),
    )
    
    db_project = models.Project(**project_data)
    db.add(db_project)
    await db.flush() # Get project ID
    
    for t_data in tasks_data:
        clean_task_data = filter_valid_columns(models.ProjectTask, t_data)
        clean_task_data.pop("id", None)
        clean_task_data.pop("project_id", None)
        new_task = models.ProjectTask(**clean_task_data, project_id=db_project.id)
        db.add(new_task)
        
    await db.commit()
    # Re-fetch with all relations for response to avoid greenlet errors
    return await get_project(db_project.id, request, db)

@router.get("/{project_id}", response_model=schemas.ProjectResponse)
async def get_project(project_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    cutover = await _cutover(request, db)
    if cutover and cutover.state in {"cutover", "read_only"}:
        canonical = await pv1_domain.get_pv1_project(db, request.state.tenant_id, str(project_id))
        if canonical is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return await pv1_migration.canonical_project_legacy_response(db, canonical)
    query = select(models.Project).filter(models.Project.id == project_id).options(
        selectinload(models.Project.tasks).selectinload(models.ProjectTask.subtasks),
        selectinload(models.Project.tasks).selectinload(models.ProjectTask.comments),
        selectinload(models.Project.tasks).selectinload(models.ProjectTask.qa_items),
        selectinload(models.Project.comments),
        selectinload(models.Project.qa_items)
    )
    result = await db.execute(query)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.put("/{project_id}", response_model=schemas.ProjectResponse)
async def update_project(project_id: int, data: schemas.ProjectUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    cutover = await _cutover(request, db)
    if cutover and cutover.state == "cutover":
        return await _canonical_v1_update(project_id, data, request, db)
    if cutover and cutover.state == "read_only":
        raise _cutover_write_error()
    query = select(models.Project).filter(models.Project.id == project_id).options(
        selectinload(models.Project.tasks)
    )
    result = await db.execute(query)
    db_project = result.scalar_one_or_none()
    
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    update_data = data.model_dump(exclude_unset=True)
    tasks_data = update_data.pop("tasks", None)
    if "parent_project_id" in update_data:
        await validate_project_parent_assignment(
            db,
            project_id=project_id,
            parent_project_id=update_data.get("parent_project_id"),
        )
    previous_values = {
        key: getattr(db_project, key)
        for key in ["status", "priority", "name", "type"]
    }
    
    # Auto-set completed_at if status changed to Completed
    if update_data.get("status") == "Completed" and not db_project.completed_at and not update_data.get("completed_at"):
        db_project.completed_at = func.now()

    for key, value in update_data.items():
        setattr(db_project, key, value)
    
    # Handle Nested Tasks
    if tasks_data is not None:
        existing_tasks = {t.id: t for t in db_project.tasks}
        current_task_ids = {t_data.get("id") for t_data in tasks_data if t_data.get("id")}
        
        # Delete removed tasks
        for t_id, t_obj in existing_tasks.items():
            if t_id not in current_task_ids:
                await db.delete(t_obj)

        for t_data in tasks_data:
            t_id = t_data.get("id")
            clean_task_data = filter_valid_columns(models.ProjectTask, t_data)
            # Remove id and project_id from data to avoid multiple values
            clean_task_data.pop("id", None)
            clean_task_data.pop("project_id", None)
            
            if t_id and t_id in existing_tasks:
                task = existing_tasks[t_id]
                # Check for significant changes to log
                changes = []
                if clean_task_data.get("status") and clean_task_data["status"] != task.status:
                    changes.append(f"Status: {task.status} -> {clean_task_data['status']}")
                if clean_task_data.get("progress") is not None and clean_task_data["progress"] != task.progress:
                    changes.append(f"Progress: {task.progress}% -> {clean_task_data['progress']}%")
                
                if changes:
                    meta = task.metadata_json or {}
                    history = meta.get("history", [])
                    history.append({
                        "content": f"Updated: {', '.join(changes)}",
                        "timestamp": datetime.utcnow().isoformat(),
                        "author": "system"
                    })
                    clean_task_data["metadata_json"] = {**meta, "history": history}

                for k, v in clean_task_data.items():
                    setattr(task, k, v)
            else:
                # Create new task
                new_task = models.ProjectTask(**clean_task_data, project_id=project_id)
                db.add(new_task)
        
    # Log Project Level Activity
    if update_data:
        meta = db_project.metadata_json or {}
        audit_log = meta.get("audit_log", [])
        sig_keys = ["status", "priority", "name", "type"]
        changes = [
            f"{k}: {previous_values.get(k)} -> {update_data[k]}"
            for k in sig_keys
            if k in update_data and update_data[k] != previous_values.get(k)
        ]
        if changes:
            audit_log.append({
                "content": f"Project Modified: {', '.join(changes)}",
                "timestamp": datetime.utcnow().isoformat(),
                "author": "system"
            })
            db_project.metadata_json = {**meta, "audit_log": audit_log}

    await db.commit()
    # Re-fetch with all relations for response
    return await get_project(project_id, request, db)

@router.delete("/{project_id}")
async def delete_project(project_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    db_project = await db.get(models.Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_project.is_deleted = True
    await db.commit()
    return {"message": "Project deleted"}

# --- Tasks ---
@router.post("/tasks", response_model=schemas.ProjectTaskResponse)
async def create_task(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    clean_data = filter_valid_columns(models.ProjectTask, data)
    task = models.ProjectTask(**clean_data)
    db.add(task)
    await db.commit()
    # Re-fetch task to avoid greenlet errors
    return await update_task(task.id, {}, request, db)

@router.put("/tasks/{task_id}", response_model=schemas.ProjectTaskResponse)
async def update_task(task_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    query = select(models.ProjectTask).filter(models.ProjectTask.id == task_id).options(
        selectinload(models.ProjectTask.subtasks),
        selectinload(models.ProjectTask.comments),
        selectinload(models.ProjectTask.qa_items)
    )
    result = await db.execute(query)
    task = result.scalar_one_or_none()
    if not task: raise HTTPException(404, "Task not found")
    
    clean_data = filter_valid_columns(models.ProjectTask, data)
    
    # Log changes
    changes = []
    if "status" in clean_data and clean_data["status"] != task.status:
        changes.append(f"Status: {task.status} -> {clean_data['status']}")
    if "progress" in clean_data and clean_data["progress"] != task.progress:
        changes.append(f"Progress: {task.progress}% -> {clean_data['progress']}%")
    
    if changes:
        meta = task.metadata_json or {}
        history = meta.get("history", [])
        history.append({
            "content": f"Updated: {', '.join(changes)}",
            "timestamp": datetime.utcnow().isoformat(),
            "author": "system"
        })
        clean_data["metadata_json"] = {**meta, "history": history}

    for k, v in clean_data.items(): setattr(task, k, v)
    await db.commit()
    await db.refresh(task)
    return task

# --- Comments ---
@router.post("/comments", response_model=schemas.ProjectCommentResponse)
async def create_comment(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    clean_data = filter_valid_columns(models.ProjectComment, data)
    comment = models.ProjectComment(**clean_data)
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment

# --- QA ---
@router.post("/qa", response_model=schemas.ProjectQAResponse)
async def create_qa(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    clean_data = filter_valid_columns(models.ProjectQA, data)
    qa = models.ProjectQA(**clean_data)
    db.add(qa)
    await db.commit()
    await db.refresh(qa)
    return qa

@router.put("/qa/{qa_id}", response_model=schemas.ProjectQAResponse)
async def update_qa(qa_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    if _legacy_writes_closed(await _cutover(request, db)):
        raise _cutover_write_error()
    qa = await db.get(models.ProjectQA, qa_id)
    if not qa: raise HTTPException(404, "QA item not found")
    clean_data = filter_valid_columns(models.ProjectQA, data)
    for k, v in clean_data.items(): setattr(qa, k, v)
    await db.commit()
    await db.refresh(qa)
    return qa
