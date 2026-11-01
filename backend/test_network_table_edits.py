"""Network forms and table edits preserve drafts, history, and concurrent work."""
import pytest
from sqlalchemy import event, select
from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot


async def ensure_setting_option(db, category, value, label):
    existing_id = await db.scalar(select(models.SettingOption.id).where(
        models.SettingOption.category == category,
        models.SettingOption.value == value,
    ))
    if existing_id is None:
        db.add(models.SettingOption(category=category, value=value, label=label))


async def listed(c):
    response = await c['client'].get('/api/v1/networks/connections', headers=c['headers'])
    assert response.status_code == 200, response.text
    return {row['id']: row for row in response.json()}


def edit(row, **changes):
    return {'id': row['id'], 'edit_revision': row['edit_revision'], 'changes': changes}


async def save(c, rows):
    return await c['client'].post('/api/v1/networks/connections/table-edit', headers=c['headers'], json={'rows': rows})


@pytest.mark.asyncio
async def test_table_batch_saves_only_changed_rows_with_exact_audits(network_scope, setup_db):
    c = network_scope
    rows = await listed(c)
    a, b = rows[c['rows']['owned']], rows[c['rows']['custom-source']]
    before, audits = await snapshot(c, setup_db)
    response = await save(c, [edit(a, purpose='Operator notes'), edit(b, status=b['status'])])
    assert response.status_code == 200, response.text
    assert response.json()['changed'] == response.json()['count'] == 1
    after, next_audits = await snapshot(c, setup_db)
    assert len(next_audits) == len(audits) + 1
    assert [row for row in after if row['id'] != a['id']] == [row for row in before if row['id'] != a['id']]
    assert (await listed(c))[a['id']]['edit_revision'] != a['edit_revision']


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['invalid', 'unconfigured', 'foreign', 'stale'])
async def test_bad_member_prevents_every_write(network_scope, setup_db, failure):
    c = network_scope
    rows = await listed(c)
    a, b = rows[c['rows']['owned']], rows[c['rows']['custom-source']]
    bad = edit(b, purpose='Must not apply')
    expected = 409
    if failure == 'invalid':
        bad['changes'] = {'unit': 'watts'}
        expected = 422
    elif failure == 'unconfigured':
        async with _tenant_db(setup_db, c['tenant']) as db:
            await ensure_setting_option(db, 'NetworkFarm', 'Prod', 'Production')
            await db.commit()
        bad['changes'] = {'farm': 'Unregistered farm'}
        expected = 400
    elif failure == 'foreign':
        bad['id'] = c['rows']['foreign-target']
        expected = 404
    else:
        response = await c['client'].put(f"/api/v1/networks/connections/{b['id']}", headers=c['headers'], json={'purpose': 'Other operator'})
        assert response.status_code == 200
    before = await snapshot(c, setup_db)
    response = await save(c, [edit(a, purpose='Must not partially apply'), bad])
    assert response.status_code == expected, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_audit_failure_rolls_back_whole_batch(network_scope, setup_db):
    c = network_scope
    rows = await listed(c)
    before = await snapshot(c, setup_db)
    def reject_audit(*_):
        raise RuntimeError('Controlled audit failure')
    event.listen(models.AuditLog, 'before_insert', reject_audit)
    try:
        with pytest.raises(RuntimeError, match='Controlled audit failure'):
            await save(c, [edit(rows[c['rows'][key]], purpose='Rolled back') for key in ['owned', 'custom-source']])
    finally:
        event.remove(models.AuditLog, 'before_insert', reject_audit)
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_stale_single_form_is_rejected_without_overwriting_another_operator(network_scope, setup_db):
    c = network_scope
    row = (await listed(c))[c['rows']['owned']]
    url = f"/api/v1/networks/connections/{row['id']}"
    first = await c['client'].put(url, headers=c['headers'], json={'purpose': 'New operator value', 'edit_revision': row['edit_revision']})
    assert first.status_code == 200, first.text
    before = await snapshot(c, setup_db)
    second = await c['client'].put(url, headers=c['headers'], json={'purpose': 'Stale overwrite', 'edit_revision': row['edit_revision']})
    assert second.status_code == 409, second.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('changes', [{'source_device_id': 1}, {'unknown': 'ignored?'}, {'edit_revision': '0' * 64}, {}])
async def test_table_contract_rejects_unsupported_fields(network_scope, setup_db, changes):
    c = network_scope
    row = (await listed(c))[c['rows']['owned']]
    before = await snapshot(c, setup_db)
    response = await save(c, [edit(row, **changes)])
    assert response.status_code == 422, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_duplicate_rows_are_rejected(network_scope, setup_db):
    c = network_scope
    row = edit((await listed(c))[c['rows']['owned']], purpose='Duplicate')
    before = await snapshot(c, setup_db)
    response = await save(c, [row, row])
    assert response.status_code == 422
    assert await snapshot(c, setup_db) == before
