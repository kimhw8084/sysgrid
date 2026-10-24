"""Readiness identifies the loaded backend without disclosing configuration."""
import re

import pytest

from app import runtime_diagnostics


def test_backend_identity_is_a_stable_startup_source_fingerprint():
    initial = runtime_diagnostics.BACKEND_SOURCE_SHA256
    assert re.fullmatch('[0-9a-f]{64}', initial)
    assert initial == runtime_diagnostics.backend_source_fingerprint()
    assert runtime_diagnostics.build_readiness_payload()['backend_source_sha256'] == initial


@pytest.mark.asyncio
async def test_readiness_exposes_only_safe_release_identity(seeded_admin_tenant):
    response = await seeded_admin_tenant['client'].get('/api/v1/readiness')
    assert response.status_code == 200, response.text
    result = response.json()
    assert type(result['production_mode']) is bool
    assert re.fullmatch('[0-9a-f]{64}', result['backend_source_sha256'])
    assert 'DATABASE_URL' not in response.text and 'SIGNING_KEY' not in response.text
