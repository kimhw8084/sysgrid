"""Request-scoped asset imports with the ordinary asset write contract."""
from decimal import Decimal, InvalidOperation
import json

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from ..models import models
from .devices import (
    _DEVICE_BOOLEAN_FIELDS, _DEVICE_INTEGER_MINIMUMS, _DEVICE_POWER_FIELDS,
    _DEVICE_WRITABLE_FIELDS, _device_write_data, sync_device_to_os,
)
from .utils import build_audit_log, get_audit_actor


def _asset_import_row(raw_row):
    if not isinstance(raw_row, dict):
        raise HTTPException(422, 'Each asset row must be an object')
    clean = {key: (value.strip() or None) if isinstance(value, str) else value
             for key, value in raw_row.items() if key in _DEVICE_WRITABLE_FIELDS}
    for field in clean:
        value = clean[field]
        if value is None:
            continue
        try:
            if field in _DEVICE_INTEGER_MINIMUMS:
                if type(value) not in (int, float, str):
                    raise ValueError()
                number = Decimal(str(value))
                if (not number.is_finite() or number != number.to_integral_value()
                        or not _DEVICE_INTEGER_MINIMUMS[field] <= number <= 2 ** 63 - 1):
                    raise ValueError()
                clean[field] = int(number)
            elif field in _DEVICE_POWER_FIELDS and isinstance(value, str):
                clean[field] = float(value)
            elif field in _DEVICE_BOOLEAN_FIELDS and isinstance(value, str):
                choices = {'true': True, '1': True, 'yes': True, 'y': True,
                           'false': False, '0': False, 'no': False, 'n': False}
                if value.lower() not in choices:
                    raise ValueError()
                clean[field] = choices[value.lower()]
            elif field in _DEVICE_BOOLEAN_FIELDS and type(value) is int and value in (0, 1):
                clean[field] = bool(value)
            elif field in {'metadata_json', 'reservation_info', 'logic_json'} and isinstance(value, str):
                clean[field] = json.loads(value)
                json.dumps(clean[field], allow_nan=False)
        except (ValueError, TypeError, InvalidOperation, OverflowError) as exc:
            raise HTTPException(422, f'Field {field} has an invalid value') from exc
    return _device_write_data(clean, creating=True)


async def preview_asset_rows(request, db, rows):
    # Python's JSON decoder accepts NaN/Infinity, but a preview must never echo
    # those values into a non-serializable response or silently turn them null.
    try:
        json.dumps(rows, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, 'Asset import values must be valid finite JSON') from exc

    results = []
    for index, raw in enumerate(rows):
        clean, errors = {}, []
        try:
            clean = _asset_import_row(raw)
        except HTTPException as exc:
            errors.append(exc.detail)
        results.append({'row': index + 1, 'source': raw, 'normalized': clean, 'errors': errors})

    names = sorted({row['normalized']['name'].lower() for row in results if not row['errors']})
    existing = set()
    for offset in range(0, len(names), 500):
        existing.update(await db.scalars(select(func.lower(models.Device.name)).where(
            models.Device.tenant_id == request.state.tenant_id, models.Device.is_deleted == False,
            func.lower(models.Device.name).in_(names[offset:offset + 500]),
        )))
    seen = set()
    for row in results:
        if not row['errors']:
            name = row['normalized']['name'].lower()
            if name in existing or name in seen:
                row['errors'].append('An active asset or earlier import row already uses this hostname')
            seen.add(name)
        row['status'] = 'INVALID' if row['errors'] else 'VALID'
    invalid = sum(row['status'] == 'INVALID' for row in results)
    return {'total_rows': len(results), 'valid_rows': len(results) - invalid, 'invalid_rows': invalid,
            'total_errors': sum(len(row['errors']) for row in results), 'results': results}


async def execute_asset_rows(request, db, rows):
    preview = await preview_asset_rows(request, db, rows)
    invalid = [row for row in preview['results'] if row['errors']]
    if invalid:
        return {'status': 'failed', 'errors': [f"Row {row['row']}: {', '.join(row['errors'])}" for row in invalid], 'count': 0}
    if not rows:
        return {'status': 'no_op', 'count': 0}
    try:
        devices = [models.Device(**row['normalized'], tenant_id=request.state.tenant_id,
                                 created_by_user_id=get_audit_actor(request), is_deleted=False)
                   for row in preview['results']]
        db.add_all(devices)
        await db.flush()
        for device in devices:
            await sync_device_to_os(device, db)
        db.add(build_audit_log(request=request, action='BULK_IMPORT', target_table='DEVICES', target_id='MULTIPLE',
            description=f'Bulk imported {len(devices)} asset records.',
            changes={'count': len(devices), 'ids': [row.id for row in devices[:20]], 'ids_truncated': len(devices) > 20}))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Asset import conflicts with current data; refresh the preview and retry') from exc
    except Exception:
        await db.rollback()
        raise
    return {'status': 'success', 'count': len(devices)}
