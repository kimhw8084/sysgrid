"""Revision-bound native Service batches and receipt-owned compensation."""
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from ..models import models
from .module_policy import ensure_module_access
from .operational_bulk import build_operational_bulk_summary, normalize_operational_bulk_ids, require_executable_operational_bulk
from .utils import build_audit_log, get_audit_actor


POST_FIELDS = ('edit_revision', 'status', 'service_type', 'environment', 'version', 'device_id', 'is_deleted')
REVERSIBLE_FIELDS = frozenset(POST_FIELDS) - {'edit_revision', 'device_id'}


def _hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False, default=str).encode()).hexdigest()


def _token(value, length: int, label: str) -> str:
    if not isinstance(value, str) or len(value) != length or any(char not in '0123456789abcdef' for char in value):
        raise HTTPException(400, f'{label} must be a {length}-character lowercase hexadecimal value')
    return value


def service_bulk_precondition(request: Request, ids, action, payload, services) -> str:
    return _hash({'contract': 'service-bulk-preview-v1', 'tenant': request.state.tenant_id,
        'actor': get_audit_actor(request), 'ids': sorted(ids), 'action': action, 'payload': payload,
        'services': [{'id': identity, 'revision': service.edit_revision, 'device_id': service.device_id,
                      'is_deleted': service.is_deleted} for identity, service in sorted(services.items())]})


async def _reserve_writer(request: Request, db: AsyncSession):
    # Authorization may have opened a read snapshot. Discard it before writer
    # acquisition, then recheck the current tenant/module authority under it.
    await db.rollback()
    if db.get_bind().dialect.name == 'sqlite':
        await db.execute(text('BEGIN IMMEDIATE'))
    elif db.get_bind().dialect.name != 'postgresql':
        raise HTTPException(409, 'Guarded Service batches are unavailable for this database engine.')
    await ensure_module_access('services', request, db)


def _owned_receipts(request):
    return select(models.ServiceBulkReceipt).where(
        models.ServiceBulkReceipt.tenant_id == request.state.tenant_id,
        models.ServiceBulkReceipt.actor_id == get_audit_actor(request))


async def _operation_receipt(request, db, operation_id):
    return await db.scalar(_owned_receipts(request).where(models.ServiceBulkReceipt.operation_id == operation_id))


def _replayed_result(receipt):
    if receipt.schema_version != 1 or not isinstance(receipt.result, dict):
        raise HTTPException(409, 'Service receipt cannot be safely replayed.')
    if receipt.undo_result is not None:
        return {**receipt.result, 'status': 'already_reverted', 'changed_count': 0,
                'changed_ids': [], 'unchanged_count': receipt.result['selected_count'],
                'unchanged_ids': receipt.result['selected_ids'], 'can_revert': False}
    return dict(receipt.result)


async def _projection_fingerprint(request, db, device_ids):
    devices = (await db.execute(select(models.Device.id, models.Device.os_name, models.Device.os_version).where(
        models.Device.id.in_(device_ids), models.Device.tenant_id == request.state.tenant_id).order_by(models.Device.id))).all()
    services = (await db.execute(select(models.LogicalService.id, models.LogicalService.device_id,
        models.LogicalService.edit_revision, models.LogicalService.name, models.LogicalService.version,
        models.LogicalService.updated_at).where(models.LogicalService.device_id.in_(device_ids),
        models.LogicalService.service_type == 'OS', models.LogicalService.is_deleted == False).order_by(models.LogicalService.id))).all()
    return _hash({'devices': [list(row) for row in devices], 'active_os_services': [list(row) for row in services]})


async def _sync_devices(db, device_ids):
    # The established Service owner remains authoritative for OS selection.
    from .logical_services import sync_device_os_state
    for identity in sorted(device_ids):
        await sync_device_os_state(identity, db)
    await db.flush()


async def _undo(data, request, db):
    from .logical_services import _service_scope
    receipt_id = _token(data.get('receipt_id'), 32, 'receipt_id')
    ids = normalize_operational_bulk_ids(data.get('ids'))
    if 'precondition' in data or 'operation_id' in data or data.get('payload'):
        raise HTTPException(400, 'Undo accepts only its receipt and original changed selection.')
    if data.get('dry_run', False):
        raise HTTPException(400, 'Undo requires an execution receipt, not a new preview.')
    await _reserve_writer(request, db)
    receipt = await db.scalar(_owned_receipts(request).where(models.ServiceBulkReceipt.id == receipt_id).with_for_update())
    if receipt is None:
        raise HTTPException(404, 'Service receipt not found')
    if receipt.schema_version != 1 or not isinstance(receipt.result, dict):
        raise HTTPException(409, 'Service receipt cannot be safely reverted.')
    expected_ids = receipt.result.get('changed_ids')
    if not isinstance(expected_ids, list) or any(isinstance(identity, bool) or not isinstance(identity, int) or identity <= 0 for identity in expected_ids) or set(ids) != set(expected_ids):
        raise HTTPException(409, 'Undo must refer to the exact changed Service selection.')
    if receipt.undo_result is not None:
        result = dict(receipt.undo_result)
        await db.rollback()
        return result
    if not receipt.result.get('can_revert'):
        raise HTTPException(409, 'This Service change does not support compensation.')
    rows = {row.id: row for row in (await db.scalars(select(models.LogicalService).where(
        models.LogicalService.id.in_(ids), _service_scope(request)).order_by(models.LogicalService.id).with_for_update())).all()}
    before, post = receipt.before_state, receipt.post_state
    if not isinstance(before, dict) or not isinstance(post, dict) or set(before) != {str(identity) for identity in ids} or set(post) != set(before):
        raise HTTPException(409, 'Service receipt cannot be safely reverted.')
    for identity in ids:
        key = str(identity)
        fields, expected = before[key], post[key]
        if not isinstance(fields, dict) or not fields or not set(fields) <= REVERSIBLE_FIELDS or not isinstance(expected, dict) or set(expected) != set(POST_FIELDS):
            raise HTTPException(409, 'Service receipt cannot be safely reverted.')
        if any(value is not None and not isinstance(value, bool if field == 'is_deleted' else str) for field, value in fields.items()):
            raise HTTPException(409, 'Service receipt cannot be safely reverted.')
        if identity not in rows or any(getattr(rows[identity], field) != value for field, value in expected.items()):
            raise HTTPException(409, 'Services changed after this operation. Nothing was reverted; review the latest records.')
    projection = receipt.projection_state
    if not isinstance(projection, dict) or set(projection) != {'device_ids', 'fingerprint'}:
        raise HTTPException(409, 'Service receipt cannot be safely reverted.')
    device_ids = projection['device_ids']
    if not isinstance(device_ids, list) or any(isinstance(identity, bool) or not isinstance(identity, int) or identity <= 0 for identity in device_ids):
        raise HTTPException(409, 'Service receipt cannot be safely reverted.')
    if device_ids and await _projection_fingerprint(request, db, device_ids) != projection['fingerprint']:
        raise HTTPException(409, 'Host OS state changed after this operation. Nothing was reverted; review the latest records.')
    for identity, row in rows.items():
        for field, value in before[str(identity)].items():
            # These are server-captured raw values, not new input. Preserve
            # legacy NULL/Active values instead of canonicalizing their history.
            setattr(row, field, value)
    await db.flush()
    await _sync_devices(db, device_ids)
    result = {'status': 'reverted', 'receipt_id': receipt.id, 'can_revert': False,
        **build_operational_bulk_summary(action='undo', selected_ids=ids, matched_ids=ids, changed_ids=ids, unchanged_ids=[])}
    db.add(build_audit_log(request=request, action='BULK_UNDO', target_table='logical_services', target_id='bulk',
        description='Reverted Service batch using its original server receipt.', changes={'ids': ids, 'receipt_id': receipt.id}))
    receipt.undo_result = result
    receipt.reverted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    return result


async def guarded_service_bulk(data: dict, request: Request, db: AsyncSession):
    # Import the existing canonical planning/normalization owner after module
    # initialization; both legacy and guarded paths use exactly these rules.
    from .logical_services import normalize_service_bulk, plan_service_bulk
    try:
        if not isinstance(data.get('dry_run', False), bool):
            raise HTTPException(400, 'dry_run must be a boolean')
        if str(data.get('action') or '').strip().lower() == 'undo':
            return await _undo(data, request, db)
        operation_id = _token(data.get('operation_id'), 32, 'operation_id')
        supplied = _token(data.get('precondition'), 64, 'precondition')
        ids, action, payload = normalize_service_bulk(data)
        request_hash = _hash({'ids': sorted(ids), 'action': action, 'payload': payload, 'precondition': supplied})
        dry_run = data.get('dry_run', False)
        if not dry_run:
            await _reserve_writer(request, db)
            previous = await _operation_receipt(request, db, operation_id)
            if previous is not None:
                if previous.request_hash != request_hash:
                    raise HTTPException(409, 'operation_id already belongs to a different Service request.')
                result = _replayed_result(previous)
                await db.rollback()
                return result
        ids, action, payload, services, summary = await plan_service_bulk(data, request, db, lock=not dry_run)
        fingerprint = service_bulk_precondition(request, ids, action, payload, services)
        if dry_run:
            return {'status': 'preview', **summary, 'precondition': fingerprint,
                    'versions': {str(identity): row.edit_revision for identity, row in services.items()}}
        # A PostgreSQL peer can finish while this request waits for row locks.
        previous = await _operation_receipt(request, db, operation_id)
        if previous is not None:
            if previous.request_hash != request_hash:
                raise HTTPException(409, 'operation_id already belongs to a different Service request.')
            result = _replayed_result(previous)
            await db.rollback()
            return result
        require_executable_operational_bulk(summary)
        if supplied != fingerprint:
            raise HTTPException(409, {'message': 'Service preview is stale. Nothing was changed; review a fresh preview.',
                                     'preview': {'status': 'preview', **summary, 'precondition': fingerprint}})
        changed = [services[identity] for identity in summary['changed_ids']]
        fields = list(payload) if action == 'update' else ['is_deleted']
        before = {str(row.id): {field: getattr(row, field) for field in fields} for row in changed}
        devices = {row.device_id for row in changed if row.device_id}
        had_os = any(row.service_type == 'OS' for row in changed)
        for row in changed:
            values = payload if action == 'update' else {'is_deleted': action == 'delete'}
            for field, value in values.items():
                setattr(row, field, value)
        await db.flush()
        devices.update(row.device_id for row in changed if row.device_id)
        if not (had_os or any(row.service_type == 'OS' for row in changed)):
            devices = set()
        await _sync_devices(db, devices)
        identity = uuid4().hex
        # Host reassignment compensation needs immutable Asset identity, which
        # this Service receipt does not establish. Existing released UI fields
        # remain reversible; legacy API host writes retain their existing path.
        reversible = bool(changed) and 'device_id' not in payload
        result = {'status': 'success' if changed else 'no_op', **summary, 'selected_ids': ids,
                  'receipt_id': identity, 'can_revert': reversible}
        receipt = models.ServiceBulkReceipt(id=identity, tenant_id=request.state.tenant_id,
            actor_id=get_audit_actor(request), operation_id=operation_id, request_hash=request_hash,
            schema_version=1, before_state=before,
            post_state={str(row.id): {field: getattr(row, field) for field in POST_FIELDS} for row in changed},
            projection_state={'device_ids': sorted(devices), 'fingerprint': await _projection_fingerprint(request, db, devices) if devices else None},
            result=result)
        db.add(receipt)
        if changed:
            db.add(build_audit_log(request=request, action=f'BULK_{action.upper()}', target_table='logical_services', target_id='bulk',
                description=f'Applied guarded Service batch: {action}', changes={'ids': summary['changed_ids'],
                    'payload': payload, 'receipt_id': identity, 'selected_count': summary['selected_count'],
                    'changed_count': summary['changed_count'], 'unchanged_count': summary['unchanged_count']}))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            previous = await _operation_receipt(request, db, operation_id)
            if previous is None or previous.request_hash != request_hash:
                raise
            return _replayed_result(previous)
        return result
    except StaleDataError as exc:
        await db.rollback()
        raise HTTPException(409, 'Services changed during this request. Nothing was changed; review a fresh preview.') from exc
    except OperationalError as exc:
        await db.rollback()
        code = getattr(exc.orig, 'sqlite_errorcode', None)
        state = getattr(exc.orig, 'sqlstate', None) or getattr(exc.orig, 'pgcode', None)
        if (isinstance(code, int) and (code & 0xFF) in {5, 6}) or state in {'40001', '40P01', '55P03'}:
            raise HTTPException(409, 'Service data is busy. Review the latest records and try again.') from exc
        raise
    except Exception:
        await db.rollback()
        raise
