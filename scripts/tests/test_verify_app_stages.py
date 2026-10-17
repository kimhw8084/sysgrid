"""Qualification stages preserve coverage, failure status and fail-closed admission."""
import json
import os
import re
import shlex
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
VERIFIER = ROOT / 'scripts/verify-app.sh'
STAGES = ['checks', 'normal-v1', 'desktop', 'root-preview']
CONFIGS = ['playwright.v1.config.ts', 'playwright.desktop.config.ts', 'playwright.root-preview.config.ts']


@pytest.fixture
def staged_executor(tmp_path):
    scripts = tmp_path / 'scripts'
    (scripts / 'lib').mkdir(parents=True)
    script = scripts / 'verify-app.sh'
    script.write_bytes(VERIFIER.read_bytes())
    (tmp_path / 'backend/test-results').mkdir(parents=True)
    sentinel = tmp_path / 'backend/test-results/preserve-on-rejected-admission'
    sentinel.write_text('Unrelated previous evidence')
    (tmp_path / 'frontend/node_modules/.bin').mkdir(parents=True)
    binaries = tmp_path / 'bin'
    binaries.mkdir()
    trace = tmp_path / 'trace.jsonl'
    command = f'''#!{sys.executable}
import json, os, sys
from pathlib import Path
event = {{'command': Path(sys.argv[0]).name, 'args': sys.argv[1:],
         'profile': os.environ.get('SYSGRID_VERIFY_PROFILE'),
         'desktop': os.environ.get('SYSGRID_DESKTOP_ONLY'),
         'root': os.environ.get('SYSGRID_VERIFY_CONTROL_PLANE_ADMIN_USER_IDS')}}
with Path(os.environ['TRACE']).open('a') as stream: stream.write(json.dumps(event) + '\\n')
if os.environ.get('FAIL_COMMAND') == event['command']: raise SystemExit(17)
if os.environ.get('FAIL_CONFIG') and os.environ['FAIL_CONFIG'] in ' '.join(sys.argv[1:]): raise SystemExit(17)
'''
    for name in ['python', 'node', 'npm', 'bash', 'probe']:
        target = binaries / name
        target.write_text(command)
        target.chmod(0o700)
    playwright = tmp_path / 'frontend/node_modules/.bin/playwright'
    playwright.write_text(command)
    playwright.chmod(0o700)
    (scripts / 'lib/verify-runtime.sh').write_text('''
VERIFY_RUNTIME_CLEANED=false
VERIFY_RUNTIME_DIR=""
VERIFY_RUNTIME_BACKEND_PID=""
VERIFY_RUNTIME_FRONTEND_PID=""
verify_runtime_resolve_python() { export PYTHON_BIN="$FAKE_BIN/python"; }
verify_runtime_resolve_node() { export NODE_BIN="$FAKE_BIN/node"; }
verify_runtime_start() { verify_runtime_resolve_node; "$FAKE_BIN/probe" start; }
verify_runtime_run_command() { "$@"; }
verify_runtime_cleanup() { "$FAKE_BIN/probe" cleanup; }
''')

    def run(*args, root_user='test-system-root', **extra):
        env = os.environ.copy()
        for name in ['SYSGRID_VERIFY_PROFILE', 'SYSGRID_DESKTOP_ONLY', 'SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID',
                     'SYSGRID_VERIFY_CONTROL_PLANE_ADMIN_USER_IDS', 'FAIL_COMMAND', 'FAIL_CONFIG']:
            env.pop(name, None)
        env.update(PATH=str(binaries) + os.pathsep + env['PATH'], TRACE=str(trace), FAKE_BIN=str(binaries), **extra)
        if root_user is not None:
            env['SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID'] = root_user
        result = subprocess.run(['/bin/bash', str(script), *args], env=env, text=True, capture_output=True, timeout=10)
        events = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
        return result, events, sentinel
    return run


def browser_configs(events):
    return [arg.split('=', 1)[1] for event in events for arg in event['args'] if arg.startswith('--config=')]


@pytest.mark.parametrize('stage', STAGES)
def test_selected_stage_runs_its_complete_scope_only(staged_executor, stage):
    result, events, _ = staged_executor('--stage', stage)
    assert result.returncode == 0, result.stderr
    assert browser_configs(events) == ([] if stage == 'checks' else [dict(zip(STAGES[1:], CONFIGS))[stage]])
    assert any(event['command'] == 'npm' for event in events) == (stage == 'checks')
    starts = [event for event in events if event['command'] == 'probe' and event['args'] == ['start']]
    if stage != 'checks':
        assert len(starts) == 1
        assert starts[0]['profile'] == ('root-preview' if stage == 'root-preview' else 'normal-v1')
        invocation = next(event for event in events if any(arg.startswith('--config=') for arg in event['args']))
        assert (invocation['desktop'] == '1') == (stage == 'desktop')
        if stage == 'root-preview':
            assert starts[0]['root'] == 'test-system-root'


@pytest.mark.parametrize('args', [(), ('--stage', 'all')])
def test_default_and_explicit_all_preserve_every_gate_in_order(staged_executor, args):
    result, events, _ = staged_executor(*args)
    assert result.returncode == 0, result.stderr
    assert browser_configs(events) == CONFIGS
    assert any(event['command'] == 'npm' for event in events)
    assert events.index(next(event for event in events if event['command'] == 'npm')) < events.index(
        next(event for event in events if any(arg.startswith('--config=') for arg in event['args'])))


def test_checks_stage_retains_canonical_backend_startup_and_frontend_coverage(staged_executor):
    result, events, _ = staged_executor('--stage', 'checks')
    assert result.returncode == 0, result.stderr
    tests = shlex.split(re.search(r'BACKEND_QUALIFICATION_TESTS=\((.*?)\)', VERIFIER.read_text(), re.S).group(1))
    backend = next(event for event in events if 'test_migration_graph.py' in event['args'])
    assert backend['args'] == ['-m', 'pytest', '-q', *tests] and len(tests) == 72
    assert len(set(tests)) == 72
    assert {'test_monitoring_stale_form.py', 'test_monitoring_edit_migration.py'} <= set(tests)
    assert {'test_settings_deployment_boundary.py', 'test_settings_legacy_boundary.py',
            'test_devices_api_edges.py', 'test_asset_architecture_traceability.py'} <= set(tests)
    assert {'test_monitoring_history_authority.py', 'test_monitoring_domain_contract.py',
            'test_monitoring_purge_authority.py', 'tests/test_monitoring_helpers.py'} <= set(tests)
    startup = next(event for event in events if 'scripts/tests/test_safe_startup.py' in event['args'])
    assert [arg for arg in startup['args'] if arg.endswith('.py')] == [
        'scripts/tests/test_safe_startup.py',
        'scripts/tests/test_runtime_origin_config.py',
        'scripts/tests/test_verify_runtime_ownership.py',
        'scripts/tests/test_production_data_guard.py',
        'scripts/tests/test_production_lifecycle.py',
        'scripts/tests/test_production_preflight.py',
        'scripts/tests/test_corporate_publishability_guard.py',
        'scripts/tests/test_production_operations.py',
        'scripts/tests/test_verify_app_stages.py',
    ]
    assert any(event['command'] == 'python' and event['args'] == ['scripts/tests/test_application_ci_contract.py'] for event in events)
    assert any(event['command'] == 'bash' and event['args'] == ['scripts/workstation-up.sh', '--self-test'] for event in events)
    assert [event['args'] for event in events if event['command'] == 'npm'] == [
        ['run', 'check:operational-contracts'], ['run', 'typecheck'], ['run', 'test:coverage'], ['run', 'build']]
    assert [event['args'] for event in events if event['command'] == 'node'] == [
        ['scripts/check-theme-preference.mjs'], ['scripts/check-dev-server-boundary.mjs'], ['scripts/check-desktop-test-selection.mjs']]


@pytest.mark.parametrize('args', [('--stage',), ('--stage', ''), ('--stage', 'unknown'), ('--stage', 'normal'),
                                 ('--stage', 'checks', 'extra'), ('--unknown', 'checks'), ('checks',)])
def test_invalid_stage_stops_before_evidence_reset_or_any_command(staged_executor, args):
    result, events, sentinel = staged_executor(*args)
    assert result.returncode != 0
    assert not events and sentinel.read_text() == 'Unrelated previous evidence'


@pytest.mark.parametrize('config', CONFIGS)
def test_failed_browser_stage_keeps_failure_and_prevents_later_gates(staged_executor, config):
    result, events, _ = staged_executor('--stage', 'all', FAIL_CONFIG=config)
    assert result.returncode == 17
    assert browser_configs(events) == CONFIGS[:CONFIGS.index(config) + 1]
    assert events[-1]['command'] == 'probe' and events[-1]['args'] == ['cleanup']


def test_failed_checks_do_not_start_a_browser(staged_executor):
    result, events, _ = staged_executor('--stage', 'all', FAIL_COMMAND='npm')
    assert result.returncode == 17 and not browser_configs(events)


def test_root_preview_never_infers_an_identity(staged_executor):
    result, events, _ = staged_executor('--stage', 'root-preview', root_user=None)
    assert result.returncode != 0 and 'requires SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID' in result.stderr
    assert not browser_configs(events)
    assert not any(event['command'] == 'probe' and event['args'] == ['start'] for event in events)


@pytest.mark.parametrize('outcome', ['success', 'failure', 'cancelled', 'skipped', '', 'unknown'])
def test_required_check_rejects_every_incomplete_qualification_outcome(outcome):
    workflow = (ROOT / '.github/workflows/application-ci.yml').read_text()
    required = workflow.split('\n  required:\n', 1)[1]
    assert 'needs: qualification' in required and 'if: always()' in required
    block = required.split('      - name: Require every qualification stage\n', 1)[1].split('\n      - name: ', 1)[0]
    command = textwrap.dedent(block.split('        run: |\n', 1)[1])
    env = {**os.environ, 'QUALIFICATION_RESULT': outcome}
    result = subprocess.run(['/bin/bash', '-c', command], env=env, text=True, capture_output=True, timeout=5)
    assert (result.returncode == 0) == (outcome == 'success')


@pytest.mark.parametrize('outcome', ['success', 'failure', 'cancelled', 'skipped'])
@pytest.mark.parametrize('pr_base', [None, 'd' * 40])
def test_aggregate_receipt_binds_actual_outcome_candidate_trigger_and_every_stage(tmp_path, outcome, pr_base):
    workflow = (ROOT / '.github/workflows/application-ci.yml').read_text()
    required = workflow.split('\n  required:\n', 1)[1]
    block = required.split('      - name: Collect aggregate CI identity\n', 1)[1].split('\n      - name: ', 1)[0]
    code = textwrap.dedent(block.split("          python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0])
    env = {**os.environ, 'GITHUB_REPOSITORY': 'test/sysgrid', 'GITHUB_WORKFLOW': 'Application CI',
           'GITHUB_RUN_ID': '12345', 'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_SHA': 'b' * 40,
           'CANDIDATE_SHA': 'a' * 40, 'GITHUB_REF': 'refs/pull/33/merge', 'GITHUB_HEAD_REF': 'test-candidate',
           'GITHUB_REF_NAME': '33/merge', 'QUALIFICATION_RESULT': outcome,
           'FINAL_REQUIRED_GATE_RESULT': 'success' if outcome == 'success' else 'failure', 'PR_BASE_SHA': pr_base or ''}
    result = subprocess.run([sys.executable, '-c', code], cwd=tmp_path, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 0, result.stderr
    receipt = json.loads((tmp_path / 'ci-evidence/ci-identity.json').read_text())
    assert receipt['candidate_sha'] == 'a' * 40 and receipt['tested_trigger_sha'] == receipt['github_sha'] == 'b' * 40
    assert receipt['qualification_stages'] == STAGES
    assert receipt['qualification_result'] == outcome
    assert receipt['final_required_gate_result'] == env['FINAL_REQUIRED_GATE_RESULT']
    assert receipt['pr_base_sha'] == pr_base and receipt['head_ref'] == 'test-candidate'
    assert receipt['stage_evidence_artifacts'] == {stage: f"application-ci-{stage}-evidence-{'a' * 40}" for stage in STAGES}
    assert 'actually used' in receipt['runtime_provenance']
