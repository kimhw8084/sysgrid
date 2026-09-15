from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import inspect, select

from app.models import models
from app.operational_actions import service
from app.operational_actions.domain import (
    AdapterExecution,
    AdapterProgress,
    ActionStatus,
    OperationalActionDomainError,
    REGISTRY,
    SimulationRecordingAdapter,
    require_transition,
)


def _headers(tenant_id: int, *, user_id: str = "admin_root", idempotency_key: str | None = None) -> dict[str, str]:
    result = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if idempotency_key:
        result["Idempotency-Key"] = idempotency_key
    return result


async def _device(client, tenant_id: int, *, name: str = "OPS-ACTION-01") -> int:
    response = await client.post(
        "/api/v1/devices",
        headers=_headers(tenant_id),
        json={"name": name, "system": "OPS", "status": "Active", "type": "Physical"},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def _create_and_preview(client, tenant_id: int, device_id: int, *, action_key: str = "telemetry.snapshot", parameters: dict | None = None, key: str | None = None):
    key = key or str(uuid4())
    created = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=key),
        json={
            "target_device_ids": [device_id],
            "action_key": action_key,
            "parameters": parameters or {"observation": "operator-reviewed"},
        },
    )
    assert created.status_code == 200, created.text
    preview = await client.post(
        f"/api/v1/operational-actions/{created.json()['id']}/preview",
        headers=_headers(tenant_id),
    )
    assert preview.status_code == 200, preview.text
    return created.json(), preview.json()


async def _confirmed_action(client, tenant_id: int, device_id: int, *, parameters: dict | None = None):
    created, preview = await _create_and_preview(client, tenant_id, device_id, parameters=parameters)
    confirmed = await client.post(
        f"/api/v1/operational-actions/{created['id']}/confirm",
        headers=_headers(tenant_id),
        json={"preview_token": preview["preview_token"], "confirmation": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    return created["id"], preview["preview_token"]


async def _succeeded_action(client, tenant_id: int, device_id: int, *, parameters: dict | None = None):
    action_id, preview_token = await _confirmed_action(
        client,
        tenant_id,
        device_id,
        parameters=parameters,
    )
    executed = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": preview_token},
    )
    assert executed.status_code == 200, executed.text
    assert executed.json()["status"] == ActionStatus.SUCCEEDED
    return action_id


def test_state_machine_rejects_illegal_transitions():
    require_transition(ActionStatus.CREATED, ActionStatus.PREVIEWED)
    require_transition(ActionStatus.PREVIEWED, ActionStatus.CONFIRMED)
    with pytest.raises(OperationalActionDomainError):
        require_transition(ActionStatus.CREATED, ActionStatus.EXECUTING)
    with pytest.raises(OperationalActionDomainError):
        require_transition(ActionStatus.ROLLED_BACK, ActionStatus.EXECUTING)


def test_registry_is_capability_oriented_and_simulation_is_non_production():
    catalog = REGISTRY.describe()
    assert catalog["adapter"]["production_capable"] is False
    assert {item["capability_key"] for item in catalog["capabilities"]} >= {
        "inventory.discovery",
        "telemetry.read",
        "remote.execution",
        "service.control",
    }
    adapter = SimulationRecordingAdapter()
    result = adapter.execute(action_id="test", target_ids=[1], parameters={})
    assert result.success is True
    assert result.result["performed"] is False
    assert result.result["external_side_effect"] is False


@pytest.mark.asyncio
async def test_simulation_lifecycle_progress_verification_history_and_asset_projection(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id)
    created, preview = await _create_and_preview(client, tenant_id, device_id)
    action_id = created["id"]
    token = preview["preview_token"]

    blocked = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CONFIRMATION_REQUIRED"

    confirmed = await client.post(
        f"/api/v1/operational-actions/{action_id}/confirm",
        headers=_headers(tenant_id),
        json={"preview_token": token, "confirmation": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == ActionStatus.CONFIRMED

    executed = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert executed.status_code == 200, executed.text
    body = executed.json()
    assert body["status"] == ActionStatus.SUCCEEDED
    assert body["progress_percent"] == 100
    assert body["execution_result"]["performed"] is False
    assert body["execution_result"]["external_side_effect"] is False
    assert [event["event_type"] for event in body["history"]].count("execution_progress") == 3

    duplicate_execute = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert duplicate_execute.status_code == 200
    assert duplicate_execute.json()["id"] == action_id
    assert len(duplicate_execute.json()["history"]) == len(body["history"])

    verified = await client.post(
        f"/api/v1/operational-actions/{action_id}/verify",
        headers=_headers(tenant_id),
        json={
            "success": True,
            "summary": "Recorded simulation result reviewed",
            "evidence": [{"evidence_type": "review", "summary": "Operator checked the simulation record", "reference": "ticket-17"}],
        },
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == ActionStatus.VERIFIED
    assert verified.json()["evidence"][0]["evidence_type"] == "verification:review"

    asset_history = await client.get(
        f"/api/v1/operational-actions/devices/{device_id}/history",
        headers=_headers(tenant_id),
    )
    assert asset_history.status_code == 200
    assert [item["id"] for item in asset_history.json()] == [action_id]
    deleted = await client.delete(f"/api/v1/devices/{device_id}", headers=_headers(tenant_id))
    assert deleted.status_code == 200, deleted.text
    historical_asset_history = await client.get(
        f"/api/v1/operational-actions/devices/{device_id}/history",
        headers=_headers(tenant_id),
    )
    assert historical_asset_history.status_code == 200
    assert [item["id"] for item in historical_asset_history.json()] == [action_id]

    async with setup_db[1]() as config_session:
        tenant = await config_session.get(__import__("app.models.config", fromlist=["Tenant"]).Tenant, tenant_id)
        engine = __import__("app.database", fromlist=["get_tenant_engine"]).get_tenant_engine(tenant.db_url)
    async_session_factory = __import__("sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]).async_sessionmaker(
        bind=engine,
        autoflush=False,
        expire_on_commit=False,
        class_=__import__("sqlalchemy.ext.asyncio", fromlist=["AsyncSession"]).AsyncSession,
    )
    async with async_session_factory() as db:
        stored = await db.get(models.OperationalAction, action_id)
        events = (await db.execute(select(models.OperationalActionEvent).where(models.OperationalActionEvent.action_id == action_id))).scalars().all()
        audit = (await db.execute(select(models.AuditLog).where(models.AuditLog.target_table == "operational_actions", models.AuditLog.target_id == action_id))).scalars().all()
        assert stored is not None
        assert len(events) >= 8
        assert audit


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt_after_progress", [False, True])
async def test_forward_interruption_is_reconciled_without_adapter_replay(
    client,
    seeded_admin_tenant,
    monkeypatch,
    interrupt_after_progress,
):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name=f"OPS-ACTION-FORWARD-{interrupt_after_progress}")
    action_id, preview_token = await _confirmed_action(client, tenant_id, device_id)
    adapter = REGISTRY._adapter
    calls = 0

    def interrupted_execute(*, action_id, target_ids, parameters):
        nonlocal calls
        calls += 1
        if not interrupt_after_progress:
            return AdapterExecution(
                progress=(),
                success=True,
                result={"performed": False, "external_side_effect": False, "mode": "test"},
            )
        return AdapterExecution(
            progress=(AdapterProgress(35, "Test progress was durably recorded."),),
            success=True,
            result={"performed": False, "external_side_effect": False, "mode": "test"},
        )

    monkeypatch.setattr(adapter, "execute", interrupted_execute)
    original_record_progress = service._record_adapter_progress

    async def interrupt_after_claim_or_progress(*args, **kwargs):
        if interrupt_after_progress:
            await original_record_progress(*args, **kwargs)
        raise service.OperationalActionError("simulated process interruption", code="SIMULATED_INTERRUPTION")

    monkeypatch.setattr(service, "_record_adapter_progress", interrupt_after_claim_or_progress)
    interrupted_response = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": preview_token},
    )
    assert interrupted_response.status_code == 409
    assert interrupted_response.json()["detail"]["code"] == "SIMULATED_INTERRUPTION"

    interrupted = await client.get(f"/api/v1/operational-actions/{action_id}", headers=_headers(tenant_id))
    assert interrupted.status_code == 200
    body = interrupted.json()
    attempt_id = body["execution_attempt_id"]
    assert body["status"] == ActionStatus.EXECUTING
    assert body["attempts"][-1]["id"] == attempt_id
    assert body["attempts"][-1]["status"] == "CLAIMED"
    assert body["attempts"][-1]["progress_percent"] == (35 if interrupt_after_progress else 0)
    assert body["execution_result"] == {}

    replay = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": preview_token},
    )
    assert replay.status_code == 409
    assert replay.json()["detail"]["code"] == "EXECUTION_IN_PROGRESS"
    assert calls == 1

    reconciled = await client.post(
        f"/api/v1/operational-actions/{action_id}/reconcile",
        headers=_headers(tenant_id),
        json={"attempt_id": attempt_id, "phase": "EXECUTION", "summary": "Operator closed the interrupted attempt"},
    )
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["status"] == ActionStatus.RECOVERY_REQUIRED
    assert reconciled.json()["attempts"][-1]["status"] == "OUTCOME_UNKNOWN"

    refused = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": preview_token},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "EXECUTION_OUTCOME_UNKNOWN"
    assert calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt_after_progress", [False, True])
async def test_rollback_interruption_is_reconciled_without_adapter_replay(
    client,
    seeded_admin_tenant,
    monkeypatch,
    interrupt_after_progress,
):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name=f"OPS-ACTION-ROLLBACK-{interrupt_after_progress}")
    action_id = await _succeeded_action(client, tenant_id, device_id)
    adapter = REGISTRY._adapter
    calls = 0

    def interrupted_rollback(*, action_id, target_ids, parameters):
        nonlocal calls
        calls += 1
        if not interrupt_after_progress:
            return AdapterExecution(
                progress=(),
                success=True,
                result={"performed": False, "external_side_effect": False, "mode": "test"},
            )
        return AdapterExecution(
            progress=(AdapterProgress(45, "Test rollback progress was durably recorded."),),
            success=True,
            result={"performed": False, "external_side_effect": False, "mode": "test"},
        )

    monkeypatch.setattr(adapter, "rollback", interrupted_rollback)
    original_record_progress = service._record_adapter_progress

    async def interrupt_after_claim_or_progress(*args, **kwargs):
        if interrupt_after_progress:
            await original_record_progress(*args, **kwargs)
        raise service.OperationalActionError("simulated process interruption", code="SIMULATED_INTERRUPTION")

    monkeypatch.setattr(service, "_record_adapter_progress", interrupt_after_claim_or_progress)
    interrupted_response = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "reason": "Test interrupted rollback"},
    )
    assert interrupted_response.status_code == 409
    assert interrupted_response.json()["detail"]["code"] == "SIMULATED_INTERRUPTION"

    interrupted = await client.get(f"/api/v1/operational-actions/{action_id}", headers=_headers(tenant_id))
    assert interrupted.status_code == 200
    body = interrupted.json()
    attempt_id = body["rollback_attempt_id"]
    assert body["status"] == ActionStatus.ROLLING_BACK
    assert body["attempts"][-1]["phase"] == "ROLLBACK"
    assert body["attempts"][-1]["status"] == "CLAIMED"
    assert body["attempts"][-1]["progress_percent"] == (45 if interrupt_after_progress else 0)

    replay = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "attempt_id": attempt_id, "reason": "Replay interrupted rollback"},
    )
    assert replay.status_code == 200
    assert replay.json()["status"] == ActionStatus.ROLLING_BACK
    assert calls == 1

    reconciled = await client.post(
        f"/api/v1/operational-actions/{action_id}/reconcile",
        headers=_headers(tenant_id),
        json={"attempt_id": attempt_id, "phase": "ROLLBACK", "summary": "Operator closed the interrupted rollback"},
    )
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["status"] == ActionStatus.RECOVERY_REQUIRED
    assert reconciled.json()["attempts"][-1]["status"] == "OUTCOME_UNKNOWN"

    refused = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "attempt_id": attempt_id, "reason": "Replay reconciled rollback"},
    )
    assert refused.status_code == 400
    assert refused.json()["detail"]["code"] == "ACTION_INVALID_REQUEST"
    assert calls == 1


@pytest.mark.asyncio
async def test_completed_rollback_replay_and_explicit_new_attempt_after_failure(client, seeded_admin_tenant, monkeypatch):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-ROLLBACK-REPLAY")
    adapter = REGISTRY._adapter
    calls = 0
    original_rollback = adapter.rollback

    def counted_rollback(*, action_id, target_ids, parameters):
        nonlocal calls
        calls += 1
        return original_rollback(action_id=action_id, target_ids=target_ids, parameters=parameters)

    monkeypatch.setattr(adapter, "rollback", counted_rollback)
    action_id = await _succeeded_action(client, tenant_id, device_id)
    first_id = str(uuid4())
    first = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "attempt_id": first_id, "reason": "Complete simulated rollback"},
    )
    assert first.status_code == 200
    assert first.json()["status"] == ActionStatus.ROLLED_BACK
    replay = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "attempt_id": first_id, "reason": "Replay completed rollback"},
    )
    assert replay.status_code == 200
    assert replay.json()["status"] == ActionStatus.ROLLED_BACK
    assert calls == 1

    failed_action_id = await _succeeded_action(
        client,
        tenant_id,
        await _device(client, tenant_id, name="OPS-ACTION-ROLLBACK-FAILED"),
        parameters={"simulation_rollback_outcome": "failure"},
    )
    failed_id = str(uuid4())
    failed = await client.post(
        f"/api/v1/operational-actions/{failed_action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "attempt_id": failed_id, "reason": "Record failed simulated rollback"},
    )
    assert failed.status_code == 200
    assert failed.json()["status"] == ActionStatus.ROLLBACK_FAILED
    missing_new_id = await client.post(
        f"/api/v1/operational-actions/{failed_action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "reason": "Must not replay failed attempt"},
    )
    assert missing_new_id.status_code == 400
    assert missing_new_id.json()["detail"]["code"] == "ACTION_INVALID_REQUEST"
    second_id = str(uuid4())
    second = await client.post(
        f"/api/v1/operational-actions/{failed_action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "attempt_id": second_id, "reason": "Explicitly authorize a new simulated attempt"},
    )
    assert second.status_code == 200
    assert second.json()["status"] == ActionStatus.ROLLBACK_FAILED
    assert calls == 3
    assert len([item for item in second.json()["attempts"] if item["phase"] == "ROLLBACK"]) == 2


@pytest.mark.asyncio
async def test_concurrent_same_attempt_rollback_has_one_adapter_invocation(client, seeded_admin_tenant, monkeypatch):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-ROLLBACK-CONCURRENT")
    action_id = await _succeeded_action(client, tenant_id, device_id)
    adapter = REGISTRY._adapter
    calls = 0
    original_rollback = adapter.rollback

    def counted_rollback(*, action_id, target_ids, parameters):
        nonlocal calls
        calls += 1
        return original_rollback(action_id=action_id, target_ids=target_ids, parameters=parameters)

    monkeypatch.setattr(adapter, "rollback", counted_rollback)
    original_get_action = service._get_action
    barrier = asyncio.Barrier(2)
    initial_gets = 0

    async def synchronize_initial_reads(db, *, tenant_id, action_id):
        nonlocal initial_gets
        if action_id == action_id_for_test and initial_gets < 2:
            initial_gets += 1
            await barrier.wait()
        return await original_get_action(db, tenant_id=tenant_id, action_id=action_id)

    action_id_for_test = action_id
    monkeypatch.setattr(service, "_get_action", synchronize_initial_reads)
    attempt_id = str(uuid4())
    responses = await asyncio.gather(
        client.post(
            f"/api/v1/operational-actions/{action_id}/rollback",
            headers=_headers(tenant_id),
            json={"execute": True, "attempt_id": attempt_id, "reason": "Concurrent same-attempt rollback"},
        ),
        client.post(
            f"/api/v1/operational-actions/{action_id}/rollback",
            headers=_headers(tenant_id),
            json={"execute": True, "attempt_id": attempt_id, "reason": "Concurrent same-attempt rollback"},
        ),
    )
    assert all(response.status_code == 200 for response in responses), [response.text for response in responses]
    assert all(response.json()["id"] == action_id for response in responses)
    assert calls == 1
    current = await client.get(f"/api/v1/operational-actions/{action_id}", headers=_headers(tenant_id))
    assert current.json()["status"] == ActionStatus.ROLLED_BACK
    assert len([item for item in current.json()["attempts"] if item["phase"] == "ROLLBACK"]) == 1
    assert [item for item in current.json()["attempts"] if item["phase"] == "ROLLBACK"][0]["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_concurrent_idempotent_creates_converge_and_conflicts_fail_deterministically(
    client,
    seeded_admin_tenant,
    monkeypatch,
):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-CREATE-CONCURRENT")
    original_append_event = service._append_event

    async def run_race(payloads):
        barrier = asyncio.Barrier(2)
        arrivals = 0

        async def synchronize_requested(*args, **kwargs):
            nonlocal arrivals
            if kwargs.get("event_type") == "requested" and arrivals < 2:
                arrivals += 1
                await barrier.wait()
            return await original_append_event(*args, **kwargs)

        monkeypatch.setattr(service, "_append_event", synchronize_requested)
        return await asyncio.gather(
            *[
                client.post(
                    "/api/v1/operational-actions",
                    headers=_headers(tenant_id, idempotency_key="race-key"),
                    json=payload,
                )
                for payload in payloads
            ]
        )

    payload = {
        "target_device_ids": [device_id],
        "action_key": "telemetry.snapshot",
        "parameters": {"observation": "concurrent-identical"},
    }
    identical = await run_race([payload, payload])
    assert [response.status_code for response in identical] == [200, 200]
    assert identical[0].json()["id"] == identical[1].json()["id"]
    assert len(identical[0].json()["history"]) == 1

    conflicting = await run_race([
        payload,
        {
            **payload,
            "parameters": {"observation": "concurrent-conflict"},
        },
    ])
    assert sorted(response.status_code for response in conflicting) == [200, 409]
    conflict = next(response for response in conflicting if response.status_code == 409)
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSE"
    actions = await client.get("/api/v1/operational-actions", headers=_headers(tenant_id))
    assert actions.status_code == 200
    assert len([item for item in actions.json() if item["idempotency_key"] == "race-key"]) == 1


@pytest.mark.asyncio
async def test_idempotency_stale_preview_and_secret_safe_persistence(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-STALE")
    key = str(uuid4())
    created, preview = await _create_and_preview(client, tenant_id, device_id, key=key)
    duplicate = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=key),
        json={"target_device_ids": [device_id], "action_key": "telemetry.snapshot", "parameters": {"observation": "operator-reviewed"}},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == created["id"]

    reused = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=key),
        json={"target_device_ids": [device_id], "action_key": "telemetry.snapshot", "parameters": {"observation": "different"}},
    )
    assert reused.status_code == 409
    assert reused.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSE"

    changed = await client.put(
        f"/api/v1/devices/{device_id}",
        headers=_headers(tenant_id),
        json={"name": "OPS-ACTION-STALE-RENAMED"},
    )
    assert changed.status_code == 200, changed.text
    stale_confirm = await client.post(
        f"/api/v1/operational-actions/{created['id']}/confirm",
        headers=_headers(tenant_id),
        json={"preview_token": preview["preview_token"], "confirmation": True},
    )
    assert stale_confirm.status_code == 409
    assert stale_confirm.json()["detail"]["code"] == "STALE_PREVIEW"
    current = await client.get(f"/api/v1/operational-actions/{created['id']}", headers=_headers(tenant_id))
    assert current.json()["status"] == ActionStatus.STALE

    secret = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=str(uuid4())),
        json={"target_device_ids": [device_id], "action_key": "telemetry.snapshot", "parameters": {"password": "never-store"}},
    )
    assert secret.status_code == 422


@pytest.mark.asyncio
async def test_maintenance_context_and_verification_failure_are_durable(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-MAINTENANCE")
    maintenance = await client.post(
        "/api/v1/maintenance",
        headers=_headers(tenant_id),
        json={
            "device_id": device_id,
            "title": "Operational action test window",
            "start_time": "2026-09-15T01:00:00+00:00",
            "end_time": "2026-09-15T02:00:00+00:00",
            "ticket_number": "CHG-17-MAINT",
        },
    )
    assert maintenance.status_code == 200, maintenance.text
    created, preview = await _create_and_preview(client, tenant_id, device_id, key=str(uuid4()))
    action_id = created["id"]
    # The context-bearing request is separately created to ensure the action
    # schema persists the optional MaintenanceWindow/change/ticket seam.
    context_action = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=str(uuid4())),
        json={
            "target_device_ids": [device_id],
            "action_key": "asset.change_record",
            "maintenance_window_id": maintenance.json()["id"],
            "ticket_reference": "CHG-17-TICKET",
            "change_context": {"change_kind": "simulated-record"},
        },
    )
    assert context_action.status_code == 200, context_action.text
    assert context_action.json()["maintenance_window_id"] == maintenance.json()["id"]
    assert context_action.json()["change_context"]["ticket_reference"] == "CHG-17-TICKET"

    token = preview["preview_token"]
    confirmed = await client.post(
        f"/api/v1/operational-actions/{action_id}/confirm",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert confirmed.status_code == 200
    executed = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert executed.status_code == 200
    verification_failed = await client.post(
        f"/api/v1/operational-actions/{action_id}/verify",
        headers=_headers(tenant_id),
        json={"success": False, "summary": "Simulation evidence did not meet the verification criterion"},
    )
    assert verification_failed.status_code == 200
    assert verification_failed.json()["status"] == ActionStatus.VERIFICATION_FAILED
    rollback = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "reason": "Recover after failed verification"},
    )
    assert rollback.status_code == 200
    assert rollback.json()["status"] == ActionStatus.ROLLED_BACK


@pytest.mark.asyncio
async def test_missing_cross_tenant_and_unsupported_requests_fail_closed(client, seeded_admin_tenant, setup_db, tmp_path):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-TENANT-A")
    missing = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=str(uuid4())),
        json={"target_device_ids": [999999], "action_key": "telemetry.snapshot"},
    )
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "TARGET_NOT_FOUND"

    unsupported = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, idempotency_key=str(uuid4())),
        json={"target_device_ids": [device_id], "action_key": "remote.execute", "capability_key": "remote.execution"},
    )
    assert unsupported.status_code == 409
    assert unsupported.json()["detail"]["code"] == "UNSUPPORTED_CAPABILITY_OR_ADAPTER"

    from app.models.config import Tenant, UserTenantAccess

    async with setup_db[1]() as config_session:
        tenant_b_url = f"sqlite+aiosqlite:///{tmp_path / 'tenant_b.db'}"
        tenant_b = Tenant(name=f"Action Tenant B {uuid4()}", db_url=tenant_b_url, is_active=True)
        config_session.add(tenant_b)
        await config_session.flush()
        tenant_b_id = tenant_b.id
        config_session.add(UserTenantAccess(user_id="admin_root", tenant_id=tenant_b_id, role="ADMIN", is_selected=False))
        await config_session.commit()
    from app.api.tenants import run_alembic_upgrade
    upgraded, error = await __import__("asyncio").to_thread(run_alembic_upgrade, tenant_b_url)
    assert upgraded, error
    cross_tenant = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_b_id, idempotency_key=str(uuid4())),
        json={"target_device_ids": [device_id], "action_key": "telemetry.snapshot"},
    )
    assert cross_tenant.status_code == 404


@pytest.mark.asyncio
async def test_high_risk_approval_recovery_gates_and_rollback_recovery(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-HIGH")
    created, preview = await _create_and_preview(
        client,
        tenant_id,
        device_id,
        action_key="service.restart",
        parameters={"service_name": "simulated-service", "simulation_rollback_outcome": "failure"},
    )
    action_id = created["id"]
    token = preview["preview_token"]
    no_facts = await client.post(
        f"/api/v1/operational-actions/{action_id}/confirm",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert no_facts.status_code == 409
    assert no_facts.json()["detail"]["code"] == "APPROVAL_FACTS_REQUIRED"

    authorized = await client.post(
        f"/api/v1/operational-actions/{action_id}/authorize",
        headers=_headers(tenant_id),
        json={
            "preview_token": token,
            "approval_facts": {"ticket_reference": "CHG-17-test"},
            "recovery_facts": {"plan_reference": "runbook-17"},
            "confirm": True,
        },
    )
    assert authorized.status_code == 200, authorized.text
    assert authorized.json()["status"] == ActionStatus.CONFIRMED
    executed = await client.post(
        f"/api/v1/operational-actions/{action_id}/execute",
        headers=_headers(tenant_id),
        json={"preview_token": token},
    )
    assert executed.status_code == 200
    assert executed.json()["status"] == ActionStatus.SUCCEEDED

    requested = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": False, "reason": "Simulation recovery requested"},
    )
    assert requested.status_code == 200
    assert requested.json()["status"] == ActionStatus.ROLLBACK_REQUESTED
    rolled_back = await client.post(
        f"/api/v1/operational-actions/{action_id}/rollback",
        headers=_headers(tenant_id),
        json={"execute": True, "reason": "Run the recorded recovery plan"},
    )
    assert rolled_back.status_code == 200
    assert rolled_back.json()["status"] == ActionStatus.ROLLBACK_FAILED
    recovered = await client.post(
        f"/api/v1/operational-actions/{action_id}/recovery",
        headers=_headers(tenant_id),
        json={"outcome": "resolved", "summary": "Simulation recovery reviewed", "recovery_facts": {"review": "operator-confirmed"}},
    )
    assert recovered.status_code == 200
    assert recovered.json()["status"] == ActionStatus.RECOVERED


@pytest.mark.asyncio
async def test_migration_registers_all_operational_tables_and_viewer_cannot_mutate(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_id = await _device(client, tenant_id, name="OPS-ACTION-SCHEMA")
    from app.database import get_tenant_engine
    from app.models.config import Tenant

    async with setup_db[1]() as config_session:
        tenant = await config_session.get(Tenant, tenant_id)
        engine = get_tenant_engine(tenant.db_url)
    async with engine.connect() as connection:
        table_names = await connection.run_sync(lambda sync_connection: set(inspect(sync_connection).get_table_names()))
    assert {
        "operational_actions",
        "operational_action_targets",
        "operational_action_events",
        "operational_action_evidence",
        "operational_action_attempts",
    }.issubset(table_names)
    async with engine.connect() as connection:
        action_columns = await connection.run_sync(
            lambda sync_connection: {column["name"] for column in inspect(sync_connection).get_columns("operational_actions")}
        )
    assert {"execution_attempt_id", "rollback_attempt_id"}.issubset(action_columns)

    async with setup_db[1]() as config_session:
        config_session.add(__import__("app.models.config", fromlist=["UserTenantAccess"]).UserTenantAccess(user_id="viewer-action", tenant_id=tenant_id, role="VIEWER", is_selected=False))
        await config_session.commit()
    forbidden = await client.post(
        "/api/v1/operational-actions",
        headers=_headers(tenant_id, user_id="viewer-action", idempotency_key=str(uuid4())),
        json={"target_device_ids": [device_id], "action_key": "telemetry.snapshot"},
    )
    assert forbidden.status_code == 403
