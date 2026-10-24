"""Revision-bound Asset commands, replay and server-captured compensation."""
import hashlib
import json
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text, func, String, Integer, Float, Boolean
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm.exc import StaleDataError

from ..models import models
from .module_policy import ensure_module_access
from .operational_bulk import normalize_operational_bulk_ids, build_operational_bulk_summary
from .utils import build_audit_log, get_audit_actor


def token(value, length, label):
    if not isinstance(value, str) or len(value) != length or any(char not in '0123456789abcdef' for char in value):
        raise HTTPException(400, f'{label} must be a {length}-character lowercase hexadecimal value')
    return value


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False, default=str).encode()).hexdigest()


def bulk_precondition(request, ids, action, payload, rows, dependencies=None):
    return fingerprint({'contract': 'asset-command-v1', 'tenant': request.state.tenant_id,
        'actor': get_audit_actor(request), 'ids': sorted(ids), 'action': action, 'payload': payload,
        'versions': {str(row.id): row.edit_revision for row in rows}, 'dependencies': dependencies})


async def os_state(db, ids):
    rows = (await db.scalars(select(models.LogicalService).where(models.LogicalService.device_id.in_(ids),
        models.LogicalService.service_type == 'OS', models.LogicalService.is_deleted == False).order_by(models.LogicalService.id))).all()
    return {str(identity): [{field: getattr(row, field) for field in ('id', 'edit_revision', 'name', 'version', 'environment')}
        for row in rows if row.device_id == identity] for identity in ids}


async def reserve_writer(request, db):
    await db.rollback()
    if db.get_bind().dialect.name == 'sqlite':
        await db.execute(text('BEGIN IMMEDIATE'))
    elif db.get_bind().dialect.name != 'postgresql':
        raise HTTPException(409, 'Guarded Asset commands are unavailable for this database engine.')
    await ensure_module_access('assets', request, db)


def owned_receipts(request):
    return select(models.AssetWriteReceipt).where(models.AssetWriteReceipt.tenant_id == request.state.tenant_id,
        models.AssetWriteReceipt.actor_id == get_audit_actor(request))


async def previous_command(request, db, operation_id):
    return await db.scalar(owned_receipts(request).where(models.AssetWriteReceipt.operation_id == operation_id))


def replay(receipt):
    if receipt.schema_version != 1 or not isinstance(receipt.result, dict) or not isinstance(receipt.undo_state, dict):
        raise HTTPException(409, 'Asset command history cannot be safely replayed.')
    if receipt.undo_state:
        ids = receipt.result.get('selected_ids', [])
        status = 'already_reverted' if len(receipt.undo_state) == len(receipt.result.get('changed_ids', [])) else 'partially_reverted'
        return {**receipt.result, 'status': status, 'changed_count': 0, 'changed_ids': [],
            'unchanged_count': len(ids), 'unchanged_ids': ids, 'can_revert': False}
    return dict(receipt.result)


async def undo(data, request, db):
    from .devices import _DEVICE_WRITABLE_FIELDS, _DEVICE_DATE_FIELDS
    if set(data) != {'action', 'ids', 'receipt_id'}:
        raise HTTPException(400, 'Asset undo requires only its receipt and changed selection.')
    identity = token(data['receipt_id'], 32, 'receipt_id')
    ids = normalize_operational_bulk_ids(data['ids'])
    await reserve_writer(request, db)
    receipt = await db.scalar(owned_receipts(request).where(models.AssetWriteReceipt.id == identity).with_for_update())
    if receipt is None:
        raise HTTPException(404, 'Asset command history not found')
    if receipt.schema_version != 1 or not isinstance(receipt.result, dict) or not receipt.result.get('can_revert'):
        raise HTTPException(409, 'This Asset command cannot be safely reverted.')
    original = receipt.result.get('changed_ids')
    if not isinstance(original, list) or any(type(identity) is not int or identity <= 0 for identity in original) or len(original) != len(set(original)) or not ids or not set(ids) <= set(original):
        raise HTTPException(409, 'Undo must refer to the original changed Asset selection.')
    before, post, projections, reverted = receipt.before_state, receipt.post_state, receipt.projection_state, receipt.undo_state
    if any(not isinstance(value, dict) for value in (before, post, projections, reverted)):
        raise HTTPException(409, 'Asset command history cannot be safely reverted.')
    original_keys = {str(identity) for identity in original}
    if set(before) != original_keys or set(post) != original_keys or not set(projections) <= original_keys or not set(reverted) <= original_keys or any(value is not True for value in reverted.values()):
        raise HTTPException(409, 'Asset command history cannot be safely reverted.')
    remaining = [identity for identity in ids if str(identity) not in reverted]
    if not remaining:
        result = {'status': 'already_reverted', 'receipt_id': receipt.id, 'can_revert': False,
            **build_operational_bulk_summary(action='undo', selected_ids=ids, matched_ids=ids, changed_ids=[], unchanged_ids=ids)}
        await db.rollback()
        return result
    rows = {row.id: row for row in (await db.scalars(select(models.Device).where(models.Device.id.in_(remaining),
        models.Device.tenant_id == request.state.tenant_id).order_by(models.Device.id).with_for_update())).all()}
    current_os = await os_state(db, remaining)
    for identity in remaining:
        key = str(identity)
        fields, revision = before.get(key), post.get(key)
        if not isinstance(fields, dict) or not fields or not set(fields) <= (_DEVICE_WRITABLE_FIELDS | {'is_deleted'}):
            raise HTTPException(409, 'Asset command history cannot be safely reverted.')
        if not isinstance(revision, str) or len(revision) != 32 or any(char not in '0123456789abcdef' for char in revision):
            raise HTTPException(409, 'Asset command history cannot be safely reverted.')
        for field, value in fields.items():
            column = models.Device.__table__.c[field]
            if value is None: continue
            valid = (isinstance(value, str) if isinstance(column.type, String) or field in _DEVICE_DATE_FIELDS
                else type(value) is bool if isinstance(column.type, Boolean)
                else type(value) is int if isinstance(column.type, Integer)
                else type(value) in {int, float} if isinstance(column.type, Float) else True)
            if not valid:
                raise HTTPException(409, 'Asset command history cannot be safely reverted.')
            if field in _DEVICE_DATE_FIELDS:
                try: datetime.fromisoformat(value)
                except ValueError as exc: raise HTTPException(409, 'Asset command history cannot be safely reverted.') from exc
        if identity not in rows or rows[identity].edit_revision != revision:
            raise HTTPException(409, 'Assets changed after this command. Nothing was reverted; review the latest records.')
        if key in projections:
            projection = projections[key]
            if not isinstance(projection, dict) or set(projection) != {'before', 'post'} or not isinstance(projection['before'], list):
                raise HTTPException(409, 'Host OS state cannot be safely reverted.')
            for item in projection['before']:
                if not isinstance(item, dict) or set(item) != {'id', 'edit_revision', 'name', 'version', 'environment'} or type(item['id']) is not int or any(item[field] is not None and not isinstance(item[field], str) for field in ('name', 'version', 'environment')):
                    raise HTTPException(409, 'Host OS state cannot be safely reverted.')
            if fingerprint(current_os[key]) != projection['post']:
                raise HTTPException(409, 'Host OS state changed after this command. Nothing was reverted.')
            if len({item['id'] for item in projection['before']}) != len(projection['before']) or {item['id'] for item in projection['before']} != {item['id'] for item in current_os[key]}:
                raise HTTPException(409, 'Host OS state cannot be safely reverted.')
        if fields.get('is_deleted') is False or ('name' in fields and not rows[identity].is_deleted):
            restored_name = fields.get('name', rows[identity].name)
            duplicate = await db.scalar(select(models.Device.id).where(models.Device.tenant_id == request.state.tenant_id,
                models.Device.is_deleted == False, models.Device.id != identity, func.lower(models.Device.name) == restored_name.lower()))
            if duplicate is not None:
                raise HTTPException(409, 'An active Asset already uses this hostname. Nothing was reverted.')
    for identity in remaining:
        key, row = str(identity), rows[identity]
        for field, value in before[key].items():
            if field in _DEVICE_DATE_FIELDS and isinstance(value, str): value = datetime.fromisoformat(value)
            setattr(row, field, value)
        if key in projections:
            expected = projections[key].get('before')
            if not isinstance(expected, list) or {item['id'] for item in expected} != {item['id'] for item in current_os[key]}:
                raise HTTPException(409, 'Host OS state cannot be safely reverted.')
            for state in expected:
                service = await db.get(models.LogicalService, state['id'])
                for field in ('name', 'version', 'environment'): setattr(service, field, state[field])
        db.add(build_audit_log(request=request, action='BULK_UNDO', target_table='devices', target_id=key,
            description='Reverted Asset command using server-captured values.', changes={'receipt_id': receipt.id, 'changed_fields': sorted(before[key])}))
    await db.flush()
    receipt.undo_state = {**reverted, **{str(identity): True for identity in remaining}}
    result = {'status': 'reverted', 'receipt_id': receipt.id, 'can_revert': False,
        **build_operational_bulk_summary(action='undo', selected_ids=ids, matched_ids=ids, changed_ids=remaining,
            unchanged_ids=[identity for identity in ids if identity not in remaining])}
    await db.commit()
    return result


async def guarded_bulk(data, request, db):
    from .devices import _asset_bulk
    try:
        if str(data.get('action') or '').strip().lower() == 'undo':
            return await undo(data, request, db)
        if data.get('dry_run', False) is not False:
            raise HTTPException(400, 'Guarded Asset execution requires a reviewed preview.')
        operation_id = token(data.get('operation_id'), 32, 'operation_id')
        token(data.get('precondition'), 64, 'precondition')
        if set(data) - {'action', 'ids', 'payload', 'operation_id', 'precondition', 'dry_run'}:
            raise HTTPException(400, 'Unsupported Asset command fields.')
        ids = normalize_operational_bulk_ids(data.get('ids'))
        request_hash = fingerprint({**data, 'ids': sorted(ids)})
        await reserve_writer(request, db)
        previous = await previous_command(request, db, operation_id)
        if previous is not None:
            if previous.request_hash != request_hash:
                raise HTTPException(409, 'operation_id already belongs to a different Asset request.')
            result = replay(previous)
            await db.rollback()
            return result
        receipt = models.AssetWriteReceipt(id=uuid4().hex, tenant_id=request.state.tenant_id,
            actor_id=get_audit_actor(request), operation_id=operation_id, request_hash=request_hash, schema_version=1,
            before_state={}, post_state={}, projection_state={}, undo_state={}, result={})
        return await _asset_bulk(request, data, db, receipt)
    except (StaleDataError, IntegrityError, OperationalError) as exc:
        await db.rollback()
        if isinstance(exc, OperationalError):
            code = getattr(exc.orig, 'sqlite_errorcode', None)
            state = getattr(exc.orig, 'sqlstate', None) or getattr(exc.orig, 'pgcode', None)
            if not ((isinstance(code, int) and (code & 0xFF) in {5, 6}) or state in {'40001', '40P01', '55P03'}): raise
        raise HTTPException(409, 'Asset data changed or is busy. Nothing was applied by this attempt; review the latest records. Your draft is preserved.') from exc
    except (ValueError, TypeError, OverflowError) as exc:
        await db.rollback()
        raise HTTPException(422, 'Asset commands require finite, valid JSON values.') from exc
    except Exception:
        await db.rollback()
        raise
