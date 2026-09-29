from uuid import uuid4

import pytest
from sqlalchemy import select

from app.database import get_tenant_engine
from app.models import models as legacy_models
from app.models.config import Tenant
from app.pv1 import models as pv1_models
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from app.pv1.outcomes import calculate_value_summary
from types import SimpleNamespace


def _value(value_id, amount, fraction, *, classification="Cash saving", key="benefit", parent_value_id=None, quality="Verified", kind="Measured"):
    return SimpleNamespace(id=value_id, amount=amount, fraction=fraction, classification=classification, currency_or_unit="USD", period_start=__import__("datetime").date(2026, 8, 1), period_end=__import__("datetime").date(2026, 9, 1), quality=quality, kind=kind, valuation_rate=None, attribution_key=key, parent_value_id=parent_value_id)


def test_value_summary_uses_explicit_decimal_attribution_and_deduplicates_rollup_parent():
    zero = _value("zero", "100", "0", key="zero")
    quarter = _value("quarter", "100", "0.25", key="quarter")
    full = _value("full", "100", "1", key="full")
    sibling_a = _value("sibling-a", "100", "0.5", key="shared")
    sibling_b = _value("sibling-b", "100", "0.5", key="shared")
    parent = _value("parent", "100", "1", key="rollup")
    child = _value("child", "100", "1", key="rollup", parent_value_id="parent")
    missing = _value("missing", "900", None, key="missing")
    summary = calculate_value_summary([zero, quarter, full, sibling_a, sibling_b, parent, child, missing])
    group = summary["groups"][0]
    assert group["gross_cash_benefit"] == "325"
    assert summary["excluded_rollup_parent_count"] == 1
    assert summary["excluded_unattributed_count"] == 1
    assert summary["capacity"]["valued_amount"] == "0"


def test_value_summary_keeps_zero_and_fractional_allocations_numerically_distinct():
    values = [_value("zero", "1000", "0", key="zero"), _value("fraction", "1000", "0.25", key="fraction"), _value("full", "1000", "1", key="full")]
    summary = calculate_value_summary(values)
    assert summary["groups"][0]["gross_cash_benefit"] == "1250"


def headers(tenant_id: int, command_id: str | None = None, user_id: str = "admin_root") -> dict[str, str]:
    result = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        result["Idempotency-Key"] = command_id
    return result


def command(command_id: str, command_type: str, revision: int, payload: dict) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": {"project_revision": revision}, "payload": payload}


async def tenant_session(setup_db, tenant_id: int) -> AsyncSession:
    async with setup_db[1]() as config_session:
        tenant = await config_session.get(Tenant, tenant_id)
        engine = get_tenant_engine(tenant.db_url)
    return async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)()


async def prepare_delivery(setup_db, tenant_id: int, project_id: str) -> None:
    session = await tenant_session(setup_db, tenant_id)
    try:
        project = await session.get(pv1_models.PV1Project, project_id)
        project.phase = "Validating"
        task = pv1_models.PV1Task(id=f"task-{uuid4()}", tenant_id=tenant_id, project_id=project_id, kind="Task", title="Accepted delivery task", owner_id="admin_root", status="Done", progress=100, mandatory=True, planning_weight=1, order_key=1024, created_by="admin_root", updated_by="admin_root")
        criterion = pv1_models.PV1TaskCriterion(id=f"criterion-{uuid4()}", tenant_id=tenant_id, project_id=project_id, description="Evidence reviewed", mandatory=True, state="Passed", evidence_refs=["evidence-delivery"], reviewer="admin_root", created_by="admin_root", updated_by="admin_root")
        session.add_all([task, criterion])
        await session.commit()
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_journey_6_delivery_is_independent_and_two_verified_adoption_periods_qualify(client, seeded_admin_tenant, setup_db, outcome_reference_date):
    tenant_id = seeded_admin_tenant["tenant_id"]
    created = await client.post("/api/v2/projects", headers=headers(tenant_id, str(uuid4())), json={"name": "Journey 6 Adoption", "objective": "Prove adoption after delivery."})
    assert created.status_code == 200, created.text
    project_id = created.json()["project"]["id"]
    await prepare_delivery(setup_db, tenant_id, project_id)

    metric_command = str(uuid4())
    metric_response = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, metric_command), json=command(metric_command, "metric.define", 1, {
        "name": "Eligible workflows adopted", "kind": "Adoption", "unit": "%", "direction": "Increase", "steward_id": "admin_root", "measurement_method": "Count approved eligible workflows", "population_definition": "Approved workflows eligible for the pilot", "population_version": "pilot-v1", "target_spec": {"type": "number", "operator": ">=", "value": "75"}, "required_for_success": True,
    }))
    assert metric_response.status_code == 200, metric_response.text
    metric_id = metric_response.json()["changed_entities"][0]["id"]

    measurement_ids = []
    for start, end in (("2026-08-01", "2026-08-15"), ("2026-08-15", "2026-08-29")):
        record_command = str(uuid4())
        response = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, record_command), json=command(record_command, "measurement.record", 1, {
            "metric_id": metric_id, "definition_revision": 1, "period_start": start, "period_end": end, "numerator": 64, "denominator": 80, "unit": "%", "source": "approved usage export", "quality": "Verified", "evidence": [{"id": f"evidence-{end}"}],
        }))
        assert response.status_code == 200, response.text
        measurement_ids.append(response.json()["changed_entities"][0]["id"])

    one_period = str(uuid4())
    premature = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, one_period), json=command(one_period, "delivery.accept", 1, {"task_revision_ids": [], "criterion_revision_ids": [], "evidence_revision_ids": ["evidence-delivery"], "residual_obligation_ids": [], "followups": []}))
    assert premature.status_code == 200, premature.text
    close_early = str(uuid4())
    early = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, close_early), json=command(close_early, "outcomes.close", 2, {"result": "Realized", "metric_revision_ids": [metric_id], "measurement_ids": [measurement_ids[0]], "rationale": "One period is not enough."}))
    assert early.status_code == 422
    assert early.json()["code"] == "VALIDATION_FAILED"

    close_command = str(uuid4())
    closed = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, close_command), json=command(close_command, "outcomes.close", 2, {"result": "Realized", "metric_revision_ids": [metric_id], "measurement_ids": measurement_ids, "rationale": "Two consecutive verified periods meet the reviewed target."}))
    assert closed.status_code == 200, closed.text
    project = await client.get(f"/api/v2/projects/{project_id}", headers=headers(tenant_id))
    assert project.json()["phase"] == "Delivered"
    assert project.json()["outcome_result"] == "Realized"


@pytest.mark.asyncio
async def test_journey_7_exact_decimal_roi_capacity_separation_and_finance_restriction(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    created = await client.post("/api/v2/projects", headers=headers(tenant_id, str(uuid4())), json={"name": "Journey 7 Value", "objective": "Prove measured value honestly."})
    project_id = created.json()["project"]["id"]
    access_command = str(uuid4())
    access = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, access_command), json=command(access_command, "project.set_access", 1, {"members": [{"user_id": "admin_root", "role": "Owner", "capabilities": {"financial.view": True, "financial.edit": True}}]}))
    assert access.status_code == 200, access.text
    rows = [
        {"classification": "Cash saving", "amount": "12000", "currency_or_unit": "USD", "period_start": "2026-08-01", "period_end": "2026-09-01", "attribution_key": "journey-7-benefit", "fraction": "1", "source": "verified ledger", "quality": "Verified", "evidence": [{"id": "ledger-benefit"}]},
        {"classification": "Cost", "amount": "10000", "currency_or_unit": "USD", "period_start": "2026-08-01", "period_end": "2026-09-01", "attribution_key": "journey-7-cost", "fraction": "1", "source": "verified ledger", "quality": "Verified", "evidence": [{"id": "ledger-cost"}]},
        {"classification": "Capacity value", "amount": "40", "currency_or_unit": "hours", "valuation_rate": "80", "period_start": "2026-08-01", "period_end": "2026-09-01", "attribution_key": "journey-7-capacity", "fraction": "1", "source": "approved time study", "quality": "Verified", "evidence": [{"id": "capacity-study"}]},
    ]
    for row in rows:
        command_id = str(uuid4())
        response = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id), json=command(command_id, "value.record", 2, row))
        assert response.status_code == 200, response.text
    outcomes_response = await client.get(f"/api/v2/projects/{project_id}/outcomes", headers=headers(tenant_id))
    assert outcomes_response.status_code == 200, outcomes_response.text
    financial = outcomes_response.json()["financial"]
    assert financial["groups"][0]["gross_cash_benefit"] == "12000"
    assert financial["groups"][0]["cost"] == "10000"
    assert financial["groups"][0]["roi_percent"] == "20"
    assert financial["capacity"]["units"] == "40"
    assert financial["capacity"]["valued_amount"] == "3200"
    assert financial["groups"][0]["gross_cash_benefit"] != financial["capacity"]["valued_amount"]

    restricted_created = await client.post("/api/v2/projects", headers=headers(tenant_id, str(uuid4())), json={"name": "Restricted value", "objective": "Preserve financial privacy."})
    restricted = await client.get(f"/api/v2/projects/{restricted_created.json()['project']['id']}/outcomes", headers=headers(tenant_id))
    assert restricted.status_code == 200
    assert restricted.json()["financial"]["restricted"] is True
    assert "groups" not in restricted.json()["financial"]


@pytest.mark.asyncio
async def test_outcome_revisions_zero_denominator_correction_and_atomic_attribution(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    created = await client.post("/api/v2/projects", headers=headers(tenant_id, str(uuid4())), json={"name": "Outcome edge cases", "objective": "Preserve historical truth."})
    project_id = created.json()["project"]["id"]
    metric_command = str(uuid4())
    metric = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, metric_command), json=command(metric_command, "metric.define", 1, {"name": "Adoption", "kind": "Adoption", "unit": "%", "direction": "Increase", "steward_id": "admin_root", "measurement_method": "Usage export", "target_spec": {"type": "number", "operator": ">=", "value": "50"}}))
    assert metric.status_code == 200, metric.text
    metric_id = metric.json()["changed_entities"][0]["id"]
    amend_command = str(uuid4())
    amended = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, amend_command), json=command(amend_command, "metric.amend", 1, {"metric_id": metric_id, "patch": {"target_spec": {"type": "number", "operator": ">=", "value": "75"}}, "rationale": "Approved target revision."}))
    assert amended.status_code == 200, amended.text
    revisions = await client.get(f"/api/v2/projects/{project_id}/metrics/{metric_id}/revisions", headers=headers(tenant_id))
    assert [item["definition_revision"] for item in revisions.json()["items"]] == [1, 2]
    zero_command = str(uuid4())
    zero = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, zero_command), json=command(zero_command, "measurement.record", 1, {"metric_id": metric_id, "definition_revision": 2, "period_start": "2026-08-01", "period_end": "2026-08-15", "numerator": 0, "denominator": 0, "unit": "%", "source": "empty population export"}))
    assert zero.status_code == 200, zero.text
    projected = await client.get(f"/api/v2/projects/{project_id}/outcomes", headers=headers(tenant_id))
    assert projected.json()["metrics"][0]["qualification"]["status"] == "Not applicable"
    record_command = str(uuid4())
    record = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, record_command), json=command(record_command, "measurement.record", 1, {"metric_id": metric_id, "definition_revision": 2, "period_start": "2026-08-15", "period_end": "2026-08-29", "numerator": 64, "denominator": 80, "unit": "%", "source": "usage export"}))
    measurement_id = record.json()["changed_entities"][0]["id"]
    correction_command = str(uuid4())
    correction = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, correction_command), json=command(correction_command, "measurement.correct", 1, {"measurement_id": measurement_id, "rationale": "Corrected denominator after source reconciliation.", "replacement": {"period_start": "2026-08-15", "period_end": "2026-08-29", "numerator": 60, "denominator": 80, "unit": "%", "source": "reconciled usage export", "evidence": [{"id": "reconciliation"}]}}))
    assert correction.status_code == 200, correction.text
    measurements = await client.get(f"/api/v2/projects/{project_id}/measurements", headers=headers(tenant_id))
    items = measurements.json()["items"]
    corrected = next(item for item in items if item["supersedes_id"] == measurement_id)
    assert corrected["calculated_value"] == "75"
    assert any(item["id"] == measurement_id for item in items)
    access_command = str(uuid4())
    access = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, access_command), json=command(access_command, "project.set_access", 1, {"members": [{"user_id": "admin_root", "role": "Owner", "capabilities": {"financial.view": True, "financial.edit": True}}]}))
    assert access.status_code == 200, access.text
    over_command = str(uuid4())
    over = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, over_command), json=command(over_command, "value.record", 2, {"classification": "Cash saving", "amount": "1", "currency_or_unit": "USD", "period_start": "2026-08-01", "period_end": "2026-09-01", "attribution_key": "shared", "fraction": "1.01", "source": "ledger"}))
    assert over.status_code == 422
    missing_fraction_command = str(uuid4())
    missing_fraction = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, missing_fraction_command), json=command(missing_fraction_command, "value.record", 2, {"classification": "Cash saving", "amount": "1", "currency_or_unit": "USD", "period_start": "2026-08-01", "period_end": "2026-09-01", "attribution_key": "missing-fraction", "source": "ledger"}))
    assert missing_fraction.status_code == 422
    assert missing_fraction.json()["code"] == "VALIDATION_FAILED"
