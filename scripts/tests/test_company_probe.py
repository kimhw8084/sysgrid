"""Offline probe boundaries, compact transcription and truthful incomplete gates."""
import importlib.util
import io
import json
from pathlib import Path
import zipfile

import pytest

SPEC = importlib.util.spec_from_file_location('company_probe', Path(__file__).resolve().parents[1] / 'company-probe.py')
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


@pytest.mark.parametrize('value', ['http://company.example', 'https://user:secret@company.example', 'https://company.example/path',
    'https://company.example?secret=value', 'https://company.example#fragment', 'file:///tmp/company', 'https://'])
def test_company_probe_accepts_only_explicit_https_origins(value):
    with pytest.raises(ValueError, match='HTTPS_ORIGIN_REQUIRED'): probe.origin(value)


def test_company_probe_never_follows_authentication_or_external_redirects():
    assert probe.NoRedirect().redirect_request(None, None, 302, None, {}, 'https://outside.example') is None
    assert probe.origin('https://company.example:8443/') == 'https://company.example:8443'


def test_source_fingerprints_change_with_runtime_bytes_not_frontend_tests(tmp_path):
    (tmp_path / 'view.ts').write_text('runtime')
    before = probe.source_fingerprint(tmp_path)
    (tmp_path / 'view.test.ts').write_text('unit test')
    assert probe.source_fingerprint(tmp_path) == before
    (tmp_path / 'view.ts').write_text('changed runtime')
    assert probe.source_fingerprint(tmp_path) != before


def report():
    return {'head': 'a' * 40, 'probe_sha256': 'b' * 64, 'checks': {key: {'status': 'P' if key in 'SCFADOR' else 'U'} for key in probe.ORDER}, 'production_accepted': False}


def test_summary_is_50_characters_contains_no_company_values_and_detects_copy_errors():
    value = report()
    value['private_internal_details'] = {'identity': 'private-engineer', 'origin': 'https://private-company.example'}
    code = probe.short_code(value)
    assert len(code) == 50 and 'private' not in code
    decoded = probe.decode_code(code.upper())
    assert decoded['checks']['I'] == 'U' and decoded['production_accepted'] is False
    with pytest.raises(ValueError, match='COPY_CHECK_FAILED'):
        probe.decode_code(code[:-1] + ('0' if code[-1] != '0' else '1'))


def test_probe_keeps_one_verified_archive_and_a_readable_report_internally(tmp_path):
    folder = tmp_path / 'internal-proof'
    value = report()
    code = probe.package(folder, value)
    archives = list(folder.glob('*.zip'))
    assert len(archives) == 1 and (folder / 'SUMMARY.txt').read_text().strip() == code
    with zipfile.ZipFile(archives[0]) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert set(archive.namelist()) == {'report.json', 'SUMMARY.txt', 'manifest.json'}
        for row in manifest['files']:
            raw = archive.read(row['path'])
            assert len(raw) == row['bytes'] and probe.sha(raw) == row['sha256']
        assert json.loads(archive.read('report.json')) == json.loads((folder / 'report.json').read_bytes()) == value


def test_source_mismatch_stops_before_patch_application_or_validation(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(probe, 'ROOT', tmp_path)
    def git(*args, **kwargs):
        calls.append(args)
        return b'other-branch\n'
    monkeypatch.setattr(probe, 'git', git)
    with pytest.raises(ValueError, match='HEAD_MISMATCH'): probe.verify_source('a' * 40, 'b' * 64)
    assert all(args[0] != 'apply' for args in calls)


def test_exact_source_checks_empty_patch_pre_and_post_hashes(tmp_path, monkeypatch):
    hashes, calls = {}, []
    for name in probe.CRITICAL:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('approved fixture ' + name)
        hashes[name] = probe.sha(path.read_bytes())
    monkeypatch.setattr(probe, 'ROOT', tmp_path)
    monkeypatch.setattr(probe, '__file__', str(tmp_path / 'scripts/company-probe.py'))
    def git(*args, data=None):
        calls.append((args, data))
        if args[0] == 'branch': return b'main\n'
        if args[0] == 'rev-parse': return ('a' * 40).encode()
        if args[0] == 'show': return (tmp_path / args[1].split(':', 1)[1]).read_bytes()
        return b''
    monkeypatch.setattr(probe, 'git', git)
    assert probe.verify_source('a' * 40, hashes['scripts/company-probe.py']) == hashes
    assert [(args, data) for args, data in calls if args[0] == 'apply'] == [
        (('apply', '--allow-empty', '--check', '-'), b''), (('apply', '--allow-empty', '-'), b'')]


def test_quick_probe_never_promotes_unobserved_company_gates(tmp_path, monkeypatch):
    root = tmp_path / 'checkout'
    root.mkdir()
    monkeypatch.setattr(probe, 'ROOT', root)
    monkeypatch.setattr(probe, 'verify_source', lambda *args: {})
    monkeypatch.setattr(probe, 'source_fingerprint', lambda *args, **kwargs: 'c' * 64)
    monkeypatch.setattr(probe, 'command_report', lambda *args: {'exit_code': 0, 'report': {'status': 'PASS'}})
    monkeypatch.setattr(probe, 'storage_check', lambda: {'database_count': 2})
    monkeypatch.setattr(probe.sys, 'stdin', io.StringIO(''))
    monkeypatch.setattr(probe, 'git', lambda *args: b'main' if args[0] == 'branch' else b'a' * 40 if args[0] == 'rev-parse' else b'')
    output = tmp_path / 'company-proof'
    assert probe.main(['--expected-head', 'a' * 40, '--probe-sha', 'b' * 64, '--output', str(output)]) == 3
    result = json.loads((output / 'report.json').read_bytes())
    assert result['checks']['C']['status'] == 'P' and result['checks']['R']['status'] == 'P'
    assert all(result['checks'][key]['status'] == 'U' for key in 'FAIVJPLUH')
    assert result['production_accepted'] is False and result['live_database_values_modified'] is False
    assert len(list(output.glob('*.zip'))) == 1


def test_missing_source_binding_never_leaves_evidence_or_runs_children(tmp_path, monkeypatch):
    monkeypatch.setattr(probe, 'verify_source', lambda *args: (_ for _ in ()).throw(ValueError('SOURCE_DIRTY')))
    monkeypatch.setattr(probe, 'command_report', lambda *args: pytest.fail('validation ran after source rejection'))
    output = tmp_path / 'not-created'
    assert probe.main(['--expected-head', 'a' * 40, '--probe-sha', 'b' * 64, '--output', str(output)]) == 2
    assert not output.exists()


@pytest.mark.parametrize('observed_release,expected_status', [('d' * 64, 'P'), ('e' * 64, 'F')])
def test_deployed_release_uses_existing_64_character_identity_and_exact_loaded_source(tmp_path, monkeypatch, observed_release, expected_status):
    root = tmp_path / 'checkout'
    root.mkdir()
    monkeypatch.setattr(probe, 'ROOT', root)
    monkeypatch.setattr(probe, 'verify_source', lambda *args: {})
    monkeypatch.setattr(probe, 'source_fingerprint', lambda *args, **kwargs: 'c' * 64)
    monkeypatch.setattr(probe, 'command_report', lambda *args: {'exit_code': 0, 'report': {'status': 'PASS'}})
    monkeypatch.setattr(probe, 'storage_check', lambda: {'database_count': 2})
    monkeypatch.setattr(probe.sys, 'stdin', io.StringIO(''))
    monkeypatch.setattr(probe, 'git', lambda *args: b'main' if args[0] == 'branch' else b'a' * 40 if args[0] == 'rev-parse' else b'')
    monkeypatch.setenv('PV1_RELEASE_CANDIDATE_SHA', 'd' * 64)
    monkeypatch.setattr(probe, 'fetch_json', lambda url: {
        'schema_version': 1, 'source_sha256': 'c' * 64, 'identity_mode': 'trusted_proxy',
        'status': 'ready', 'production_mode': True, 'release_candidate_sha': observed_release,
        'backend_source_sha256': 'c' * 64,
    })
    output = tmp_path / 'company-proof'
    assert probe.main(['--expected-head', 'a' * 40, '--probe-sha', 'b' * 64, '--url', 'https://company.example', '--output', str(output)]) == (3 if expected_status == 'P' else 1)
    result = json.loads((output / 'report.json').read_bytes())
    assert result['checks']['F']['status'] == 'P' and result['checks']['A']['status'] == expected_status
    assert result['production_accepted'] is False
