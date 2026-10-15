#!/usr/bin/env python3
"""Measure released V1 API capacity on an owned, disposable four-worker runtime.

No target URL or data path is accepted. Company gateway and field capacity are
separate release evidence. A shorter run is diagnostic and cannot pass the gate.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
USERS = 20
WRITERS = 3
ASSETS = 1000
READ_BUDGET_MS = 1000
WRITE_BUDGET_MS = 1000
READS = ("/devices", "/monitoring", "/logical-services", "/networks/connections", "/racks", "/audit?limit=30", "/settings/user/profile")


async def fixture() -> None:
    # This subprocess is supplied only the parent-owned temporary environment.
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.models.config import UserTenantAccess
    from app.models.models import Device, LogicalService, MonitoringItem, Operator

    engine = create_async_engine(os.environ['DATABASE_URL'])
    config_engine = create_async_engine(os.environ['CONFIG_DATABASE_URL'])
    async with async_sessionmaker(engine)() as db:
        for index in range(USERS):
            db.add(Operator(username=f'capacity.user-{index}', registration_status='Verified', is_admin=False,
                custom_permissions={key: 3 if index < WRITERS else 1 for key in ('assets', 'monitoring', 'services', 'network', 'racks', 'logs', 'settings')}))
        assets = [Device(name=f'capacity-host-{index:04d}', system='Synthetic capacity', tenant_id=1,
                  type='Physical', status='Active', owner='Synthetic owner', serial_number=f'CAP-{index:04d}') for index in range(ASSETS)]
        db.add_all(assets)
        await db.flush()
        for index, asset in enumerate(assets[:100]):
            db.add(LogicalService(device_id=asset.id, name=f'capacity-service-{index}', service_type='Other', status='Active'))
            db.add(MonitoringItem(device_id=asset.id, title=f'capacity-monitor-{index}', category='Synthetic', status='Existing'))
        await db.commit()
        ids = list(await db.scalars(select(Device.id).order_by(Device.id).limit(WRITERS)))
    async with async_sessionmaker(config_engine)() as db:
        db.add_all([UserTenantAccess(user_id=f'capacity.user-{index}', tenant_id=1,
                    role='EDITOR' if index < WRITERS else 'VIEWER', is_selected=False) for index in range(USERS)])
        await db.commit()
    await engine.dispose()
    await config_engine.dispose()
    print(json.dumps({'writer_asset_ids': ids}))


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))], 3)


async def workload(origin: str, ids: list[int], duration: int) -> dict:
    import httpx
    counts: Counter[str] = Counter()
    timings: dict[str, list[float]] = {'read': [], 'write': []}
    paths: Counter[str] = Counter()
    last_write: dict[int, str] = {}
    deadline = time.monotonic() + duration
    started = time.monotonic()

    async def user(index: int) -> None:
        headers = {'X-Authenticated-User': f'capacity.user-{index}', 'X-Tenant-Id': '1'}
        async with httpx.AsyncClient(base_url=origin + '/api/v1', headers=headers, timeout=15) as client:
            iteration = 0
            while time.monotonic() < deadline:
                write = index < WRITERS and iteration % 2 == 0
                path = f'/devices/{ids[index]}' if write else READS[(iteration + index) % len(READS)]
                began = time.perf_counter()
                try:
                    if write:
                        value = f'capacity-{index}-{iteration}'
                        response = await client.put(path, json={'owner': value})
                        if response.status_code == 200:
                            last_write[index] = value
                    else:
                        response = await client.get(path)
                    kind = 'write' if write else 'read'
                    timings[kind].append((time.perf_counter() - began) * 1000)
                    paths[path.split('?')[0] if not write else '/devices/:id'] += 1
                    counts[f'{kind}_{response.status_code}'] += 1
                    if response.status_code != 200:
                        counts['failures'] += 1
                except httpx.HTTPError:
                    counts['network_failures'] += 1
                    counts['failures'] += 1
                iteration += 1
                await asyncio.sleep(2)

    await asyncio.gather(*(user(index) for index in range(USERS)))
    async with httpx.AsyncClient(base_url=origin + '/api/v1', timeout=15) as client:
        for index in range(WRITERS):
            response = await client.get('/devices', headers={'X-Authenticated-User': f'capacity.user-{index}', 'X-Tenant-Id': '1'})
            rows = response.json() if response.status_code == 200 else []
            retained = next((row for row in rows if row['id'] == ids[index]), {})
            counts['write_readback_passed'] += int(index in last_write and retained.get('owner') == last_write[index])
        forbidden = await client.put(f'/devices/{ids[0]}', headers={'X-Authenticated-User': 'capacity.user-19', 'X-Tenant-Id': '1'}, json={'owner': 'forbidden'})
        counts['viewer_write_rejected'] += int(forbidden.status_code == 403)
        foreign = await client.get('/devices', headers={'X-Authenticated-User': 'capacity.user-0', 'X-Tenant-Id': '99999'})
        counts['foreign_tenant_rejected'] += int(foreign.status_code in (403, 404))
        forged = await client.get('/devices', headers={'X-User-Id': 'capacity.admin', 'X-Tenant-Id': '1'})
        counts['browser_identity_rejected'] += int(forged.status_code == 401)
    summaries = {kind: {'samples': len(values), 'p50_client_ms': percentile(values, .5), 'p95_client_ms': percentile(values, .95), 'max_client_ms': round(max(values), 3) if values else None}
                 for kind, values in timings.items()}
    passed = bool(duration >= 900 and counts['failures'] == 0 and counts['write_readback_passed'] == WRITERS
        and all(counts[key] == 1 for key in ('viewer_write_rejected', 'foreign_tenant_rejected', 'browser_identity_rejected'))
        and all(paths.get(path, 0) for path in (p.split('?')[0] for p in READS))
        and summaries['read']['p95_client_ms'] is not None and summaries['read']['p95_client_ms'] <= READ_BUDGET_MS
        and summaries['write']['p95_client_ms'] is not None and summaries['write']['p95_client_ms'] <= WRITE_BUDGET_MS)
    return {'status': 'PASS' if passed else 'FAIL', 'duration_seconds': round(time.monotonic() - started, 3),
            'requested_seconds': duration, 'diagnostic_only': duration < 900, 'counts': dict(counts), 'timings': summaries,
            'read_paths': dict(paths), 'budgets_ms': {'read_p95': READ_BUDGET_MS, 'write_p95': WRITE_BUDGET_MS}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--duration-seconds', type=int, default=900)
    args = parser.parse_args()
    if not 1 <= args.duration_seconds <= 3600:
        parser.error('duration must be between 1 and 3600 seconds')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        parser.error('output already exists; preserve previous evidence')
    with tempfile.TemporaryDirectory(prefix='sysgrid-v1-capacity-') as temporary:
        root = Path(temporary)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        env = {'PATH': os.environ.get('PATH', os.defpath), 'PYTHONPATH': str(ROOT / 'backend'),
            'CONFIG_DATABASE_URL': f'sqlite+aiosqlite:///{root / "config.db"}',
            'DATABASE_URL': f'sqlite+aiosqlite:///{root / "tenant.db"}', 'TENANT_STORAGE_ROOT': str(root / 'tenants'),
            'ENVIRONMENT': 'development', 'IDENTITY_MODE': 'trusted_proxy', 'TRUSTED_PROXY_USER_HEADER': 'X-Authenticated-User',
            'DEFAULT_USER_ID': 'capacity.admin', 'AUTO_ADMIN_USER_IDS': 'capacity.admin',
            'SYSTEM_ROOT_USER_IDS': 'capacity.reserved-root', 'PUBLIC_READONLY_ENABLED': 'false',
            'ALLOWED_HOSTS': '127.0.0.1,localhost', 'BACKEND_CORS_ORIGINS': origin}
        log_path = args.output.with_suffix('.runtime.log')
        with log_path.open('x') as log:
            subprocess.run([sys.executable, str(ROOT / 'seed.py'), '--tenant-name', 'Capacity qualification',
                '--tenant-db', str(root / 'tenant.db'), '--admin-user', 'capacity.admin', '--no-seed-data'], cwd=ROOT, env=env, stdout=log, stderr=log, check=True)
            seeded = subprocess.run([sys.executable, '-c', 'import asyncio,runpy; asyncio.run(runpy.run_path("scripts/qualify-v1-capacity.py", run_name="fixture")["fixture"]())'],
                cwd=ROOT, env=env, capture_output=True, text=True, check=False)
            if seeded.returncode:
                log.write(seeded.stderr)
                raise RuntimeError('synthetic capacity fixture failed; see runtime log')
            ids = json.loads(seeded.stdout)['writer_asset_ids']
            process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port), '--workers', '4'],
                cwd=ROOT / 'backend', env=env, stdout=log, stderr=log)
            try:
                import httpx
                for _ in range(80):
                    try:
                        if httpx.get(origin + '/api/v1/readiness', timeout=1).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    if process.poll() is not None:
                        raise RuntimeError('owned backend exited during startup')
                    time.sleep(.25)
                else:
                    raise RuntimeError('owned backend readiness failed')
                report = asyncio.run(workload(origin, ids, args.duration_seconds))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    report.update({'schema': 'sysgrid.v1.capacity.v1', 'scope': 'synthetic_local_four_worker_api', 'company_proof': False,
        'users': USERS, 'writers': WRITERS, 'assets': ASSETS, 'think_time_seconds': 2,
        'identity': 'synthetic trusted headers; no company gateway', 'same_record_conflict_proof': False,
        'backend_source_sha256': hashlib.sha256(b''.join(path.read_bytes() for path in sorted((ROOT / 'backend/app').rglob('*.py')))).hexdigest()})
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
