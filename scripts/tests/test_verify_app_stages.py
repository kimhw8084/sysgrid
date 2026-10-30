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
STAGES = ['checks', 'normal-v1', 'desktop', 'role-matrix', 'root-preview']
CONFIGS = ['playwright.v1.config.ts', 'playwright.desktop.config.ts', 'playwright.role-matrix.config.ts', 'playwright.root-preview.config.ts']


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
         'root': os.environ.get('SYSGRID_VERIFY_CONTROL_PLANE_ADMIN_USER_IDS'),
         'tmpdir': os.environ.get('TMPDIR')}}
with Path(os.environ['TRACE']).open('a') as stream: stream.write(json.dumps(event) + '\\n')
if '--collect-only' in sys.argv:
    for filename in (arg for arg in sys.argv[1:] if arg.endswith('.py')):
        print(f'{{filename}}::test_qualification_case[0]')
        print(f'{{filename}}::test_qualification_case[1]')
if '-m' in sys.argv and 'pytest' in sys.argv and any(arg.startswith('--basetemp=') for arg in sys.argv):
    marker = Path(os.environ['TMPDIR']) / 'disposable-test-file'
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text('owned by qualification batch')
if os.environ.get('FAIL_BACKEND_FILE') and '--collect-only' not in sys.argv and any(os.environ['FAIL_BACKEND_FILE'] in arg for arg in sys.argv): raise SystemExit(17)
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
verify_runtime_resolve_node() { [[ "${FAIL_NODE:-}" != 1 ]] || return 1; export NODE_BIN="$FAKE_BIN/node"; }
verify_runtime_start() { verify_runtime_resolve_node; "$FAKE_BIN/probe" start; }
verify_runtime_run_command() { "$@"; }
verify_runtime_cleanup() { "$FAKE_BIN/probe" cleanup; }
''')

    def run(*args, root_user='test-system-root', **extra):
        env = os.environ.copy()
        for name in ['SYSGRID_VERIFY_PROFILE', 'SYSGRID_DESKTOP_ONLY', 'SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID',
                     'SYSGRID_VERIFY_CONTROL_PLANE_ADMIN_USER_IDS', 'SYSGRID_VERIFY_SHARD', 'FAIL_COMMAND', 'FAIL_CONFIG', 'FAIL_NODE', 'FAIL_BACKEND_FILE']:
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
        assert starts[0]['profile'] == (stage if stage in {'root-preview', 'role-matrix'} else 'normal-v1')
        invocation = next(event for event in events if any(arg.startswith('--config=') for arg in event['args']))
        assert invocation['desktop'] == '1'
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
    collection = next(event for event in events if '--collect-only' in event['args'])
    assert collection['args'][:4] == ['-m', 'pytest', '-q', '--collect-only']
    assert [arg for arg in collection['args'] if arg.endswith('.py')] == tests
    backend = [event for event in events if '-m' in event['args'] and 'pytest' in event['args']
               and '--collect-only' not in event['args'] and any(arg.startswith('--basetemp=') for arg in event['args'])]
    assert len(backend) == 2 and len(tests) == 98
    selected_items = [arg for event in backend for arg in event['args'] if '::' in arg]
    expected_items = [f'{test}::test_qualification_case[{index}]' for test in tests for index in range(2)]
    assert selected_items == expected_items
    assert all(event['tmpdir'] and event['args'].count(f"--basetemp={event['tmpdir']}/pytest") == 1 for event in backend)
    assert all(not Path(event['tmpdir']).exists() for event in [collection, *backend])
    assert {'test_asset_stale_form.py', 'test_asset_commands.py', 'test_asset_write_migration.py', 'test_release_identity.py'} <= set(tests)
    assert len(set(tests)) == 98
    assert {
        'test_external_vendor_revision_migration.py', 'test_external_workflows.py',
        'test_projects_workflows.py', 'tests/test_project_hierarchy.py',
        'tests/test_projects_workspace_saved_views.py', 'test_pv1_domain_foundation.py',
        'test_p04_creation_portfolio_home.py', 'test_p05_my_day_work_plan.py',
        'test_p06_schedule_core.py', 'test_p06_timeline_scheduling.py',
        'test_p06_schedule_performance.py', 'test_p07_architecture_engine.py',
        'test_p08_updates_resources_reports.py', 'test_p09_outcomes_delivery_value.py',
        'test_p10_cross_cutting_hardening.py', 'test_p11_project_portfolio_contract.py',
    } <= set(tests)
    assert {'test_network_legacy_edits.py', 'test_network_table_edits.py'} <= set(tests)
    assert 'test_service_bulk_concurrency.py' in tests
    assert 'test_audit_integrity.py' in tests
    assert {'test_monitoring_stale_form.py', 'test_monitoring_edit_migration.py'} <= set(tests)
    assert {'test_service_stale_form.py', 'test_service_edit_migration.py'} <= set(tests)
    assert {'test_settings_deployment_boundary.py', 'test_settings_legacy_boundary.py',
            'test_devices_api_edges.py', 'test_asset_architecture_traceability.py'} <= set(tests)
    assert {'test_monitoring_history_authority.py', 'test_monitoring_domain_contract.py',
            'test_monitoring_purge_authority.py', 'tests/test_monitoring_helpers.py'} <= set(tests)
    startup = next(event for event in events if 'scripts/tests/test_safe_startup.py' in event['args'])
    assert [arg for arg in startup['args'] if arg.endswith('.py')] == [
        'scripts/tests/test_safe_startup.py',
        'scripts/tests/test_runtime_origin_config.py',
        'scripts/tests/test_verify_runtime_ownership.py',
        'scripts/tests/test_verify_runtime_node.py',
        'scripts/tests/test_production_data_guard.py',
        'scripts/tests/test_production_lifecycle.py',
        'scripts/tests/test_production_preflight.py',
        'scripts/tests/test_corporate_publishability_guard.py',
        'scripts/tests/test_production_operations.py',
        'scripts/tests/test_company_probe.py',
        'scripts/tests/test_ci_shards.py',
        'scripts/tests/test_verify_app_stages.py',
    ]
    assert any(event['command'] == 'python' and event['args'] == ['scripts/tests/test_application_ci_contract.py'] for event in events)
    assert any(event['command'] == 'bash' and event['args'] == ['scripts/workstation-up.sh', '--self-test'] for event in events)
    assert [event['args'] for event in events if event['command'] == 'npm'] == [
        ['run', 'check:operational-contracts'], ['run', 'typecheck'], ['run', 'test:coverage'], ['run', 'build']]
    assert [event['args'] for event in events if event['command'] == 'node'] == [
        ['scripts/check-theme-preference.mjs'], ['scripts/check-dev-server-boundary.mjs'],
        ['scripts/check-desktop-test-selection.mjs'], ['scripts/check-normal-release-selection.mjs'],
        ['scripts/check-role-matrix-selection.mjs']]


def test_failed_backend_batch_cleans_owned_temp_and_stops_later_checks(staged_executor):
    result, events, _ = staged_executor('--stage', 'checks', FAIL_BACKEND_FILE='test_asset_stale_form.py')
    assert result.returncode == 17
    collection = next(event for event in events if '--collect-only' in event['args'])
    batch = next(event for event in events if '-m' in event['args'] and 'pytest' in event['args']
                 and '--collect-only' not in event['args'] and any('::' in arg for arg in event['args']))
    assert not Path(collection['tmpdir']).exists()
    assert not Path(batch['tmpdir']).exists()
    assert not any(event['command'] == 'npm' for event in events)


@pytest.mark.parametrize('args', [('--stage',), ('--stage', ''), ('--stage', 'unknown'), ('--stage', 'normal'),
                                 ('--stage', 'checks', 'extra'), ('--unknown', 'checks'), ('checks',)])
def test_invalid_stage_stops_before_evidence_reset_or_any_command(staged_executor, args):
    result, events, sentinel = staged_executor(*args)
    assert result.returncode != 0
    assert not events and sentinel.read_text() == 'Unrelated previous evidence'


def test_node_admission_failure_preserves_prior_evidence(staged_executor):
    result, events, sentinel = staged_executor('--stage', 'checks', FAIL_NODE='1')
    assert result.returncode != 0
    assert not events and sentinel.read_text() == 'Unrelated previous evidence'


def test_release_ledger_matches_released_catalog_and_desktop_scope():
    ledger = json.loads((ROOT / 'contracts/production-readiness-20261002.json').read_text())
    catalog = json.loads((ROOT / 'contracts/system_management_v1.json').read_text())
    released = [item['id'] for item in catalog['modules'] if item['default_stage'] == 'production']
    assert ledger['release_contract']['production_modules'] == released
    assert {(item['width'], item['height']) for item in ledger['acceptance_dimensions']['viewports']} == {
        (1024, 768), (1280, 650), (1280, 720), (1440, 900), (1920, 1080),
    }
    assert {'keyboard_only', 'screen_reader', 'zoom_200_percent', 'reflow_400_percent'} <= set(ledger['acceptance_dimensions']['interaction'])


def test_release_inventory_matches_current_app_ownership():
    suite = json.loads((ROOT / 'frontend/tests/qualification-suite.json').read_text())
    release = set(suite['release_blocking'])
    root_preview = set(suite['root_preview'])
    separate_apps = set(suite['separate_app_ownership'])
    deferred = set(suite['deferred_historical'])
    shared_released_workflows = {
        'external-workflows.spec.ts', 'far-workflows.spec.ts',
        'vendors-real-runtime.spec.ts',
    }
    assert suite['version'] == 2
    assert release & root_preview == shared_released_workflows
    assert 'golden-eight-seeded-visual-matrix.spec.ts' in release
    assert 'golden-eight-mobile-routes.spec.ts' in deferred
    assert {
        'notification-layout.spec.ts', 'notification-keyboard.spec.ts',
    } <= release
    assert {
        'far-golden-controls.spec.ts',
        'far-visible-grid.spec.ts', 'far-workflows.spec.ts',
        'release-policy-root-preview.spec.ts', 'tenant-switch-safety.spec.ts',
        'shell-dialogs.spec.ts', 'workspace-storage-preview.spec.ts',
        'external-services-bulk-preview.spec.ts', 'external-workflows.spec.ts',
        'vendors-real-runtime.spec.ts',
    } <= root_preview
    assert not (release & deferred) and not (root_preview & deferred)
    assert not (release & separate_apps) and not (root_preview & separate_apps) and not (deferred & separate_apps)
    assert {
        'architecture-workflows.spec.ts', 'knowledge-workflows.spec.ts',
        'research-workflows.spec.ts', 'projects-creation-flow.spec.ts',
        'projects-out40-slice-e-timeline-dependency-a11y.spec.ts',
        'projects-out40-slice-f-task-drawer-a11y.spec.ts',
        'projects-out40-slice-h-gantt-modernization.spec.ts',
        'projects-navigation.spec.ts', 'projects-p04-project-story.spec.ts',
        'projects-p05-work-plan.spec.ts', 'projects-p06-timeline.spec.ts',
        'projects-p07-architecture.spec.ts', 'projects-p08-communication.spec.ts',
        'projects-p09-outcomes.spec.ts', 'projects-p11-portfolio-regression.spec.ts',
        'projects-saved-views.spec.ts',
    } <= separate_apps
    normal_config = (ROOT / 'frontend/playwright.v1.config.ts').read_text()
    root_config = (ROOT / 'frontend/playwright.root-preview.config.ts').read_text()
    assert 'narrow[- ]screen' in normal_config and 'narrow[- ]screen' in root_config
    assert all(Path(spec).name.removesuffix('.spec.ts') in normal_config for spec in release)
    assert all(Path(spec).name.removesuffix('.spec.ts') in root_config for spec in root_preview)
    assert all(Path(spec).name.removesuffix('.spec.ts') not in normal_config for spec in root_preview - shared_released_workflows)
    assert all(Path(spec).name.removesuffix('.spec.ts') not in root_config for spec in release - shared_released_workflows)
    assert all(Path(spec).name.removesuffix('.spec.ts') not in normal_config for spec in deferred)
    assert all(Path(spec).name.removesuffix('.spec.ts') not in root_config for spec in deferred)
    assert all(Path(spec).name.removesuffix('.spec.ts') not in normal_config for spec in separate_apps)
    assert all(Path(spec).name.removesuffix('.spec.ts') not in root_config for spec in separate_apps)


def test_owned_browser_origins_all_target_the_isolated_backend(tmp_path):
    runtime = ROOT / 'scripts/lib/verify-runtime.sh'
    script = textwrap.dedent(f'''\
        source {shlex.quote(str(runtime))}
        VERIFY_RUNTIME_BACKEND_ORIGIN=http://127.0.0.1:49123
        VERIFY_RUNTIME_FRONTEND_ORIGIN=http://127.0.0.1:49124
        VERIFY_RUNTIME_TEST_TENANT=77
        VERIFY_RUNTIME_TEST_USER=isolated-root
        VERIFY_RUNTIME_ENV=(env)
        verify_runtime_run_command env
    ''')
    result = subprocess.run(['/bin/bash', '-c', script], capture_output=True, text=True, check=False, timeout=5)
    assert result.returncode == 0, result.stderr
    environment = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    for name in ['SYSGRID_P04_API_ORIGIN', 'SYSGRID_P05_API_ORIGIN', 'SYSGRID_P06_API_ORIGIN',
                 'SYSGRID_P07_API_ORIGIN', 'SYSGRID_P08_API_ORIGIN', 'SYSGRID_P09_API_ORIGIN', 'SYSGRID_P11_API_ORIGIN']:
        assert environment[name] == 'http://127.0.0.1:49123'
    assert environment['P11_USER_ID'] == 'isolated-root'
    assert environment['P05_USER_ID'] == 'isolated-root'
    assert environment['PW_API_BASE'] == 'http://127.0.0.1:49123/api/v1'
    assert environment['PLAYWRIGHT_BASE_URL'] == 'http://127.0.0.1:49124'


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
@pytest.mark.parametrize('union_outcome', ['success', 'failure', 'cancelled', 'skipped'])
def test_required_check_rejects_every_incomplete_qualification_outcome(outcome, union_outcome):
    workflow = (ROOT / '.github/workflows/application-ci.yml').read_text()
    required = workflow.split('\n  required:\n', 1)[1]
    assert 'needs: [qualification, normal_v1]' in required and 'if: always()' in required
    block = required.split('      - name: Require every qualification stage\n', 1)[1].split('\n      - name: ', 1)[0]
    command = textwrap.dedent(block.split('        run: |\n', 1)[1])
    env = {**os.environ, 'QUALIFICATION_RESULT': outcome, 'NORMAL_V1_RESULT': union_outcome}
    result = subprocess.run(['/bin/bash', '-c', command], env=env, text=True, capture_output=True, timeout=5)
    assert (result.returncode == 0) == (outcome == union_outcome == 'success')


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
           'FINAL_REQUIRED_GATE_RESULT': 'success' if outcome == 'success' else 'failure', 'PR_BASE_SHA': pr_base or '',
           'NORMAL_V1_RESULT': outcome}
    result = subprocess.run([sys.executable, '-c', code], cwd=tmp_path, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 0, result.stderr
    receipt = json.loads((tmp_path / 'ci-evidence/ci-identity.json').read_text())
    assert receipt['candidate_sha'] == 'a' * 40 and receipt['tested_trigger_sha'] == receipt['github_sha'] == 'b' * 40
    assert receipt['qualification_stages'] == STAGES
    assert receipt['qualification_result'] == outcome
    assert receipt['normal_v1_result'] == outcome
    assert receipt['final_required_gate_result'] == env['FINAL_REQUIRED_GATE_RESULT']
    assert receipt['pr_base_sha'] == pr_base and receipt['head_ref'] == 'test-candidate'
    assert receipt['stage_evidence_artifacts'] == {stage: f"application-ci-{stage}-evidence-{'a' * 40}" for stage in STAGES}
    assert 'actually used' in receipt['runtime_provenance']


@pytest.mark.parametrize('shard', ['1/3', '2/3', '3/3'])
def test_normal_shard_keeps_full_selection_and_adds_only_partition_argument(staged_executor, shard):
    result, events, _ = staged_executor('--stage', 'normal-v1', SYSGRID_VERIFY_SHARD=shard)
    assert result.returncode == 0, result.stderr
    browser = [event['args'] for event in events if any(arg.startswith('--config=') for arg in event['args'])]
    assert [args[1:] for args in browser] == [
        ['test', '--config=playwright.v1.config.ts', '--list', '--reporter=json'],
        ['test', '--config=playwright.v1.config.ts', f'--shard={shard}', '--reporter=list,html,json,./llm-reporter.ts'],
    ]


@pytest.mark.parametrize('stage,shard', [('normal-v1', '0/3'), ('normal-v1', '4/3'), ('normal-v1', '1/2'),
                                     ('all', '1/3'), ('checks', '1/3'), ('desktop', '1/3'), ('root-preview', '1/3')])
def test_invalid_shard_stops_before_evidence_reset_or_runtime(staged_executor, stage, shard):
    result, events, sentinel = staged_executor('--stage', stage, SYSGRID_VERIFY_SHARD=shard)
    assert result.returncode == 2 and not events
    assert sentinel.read_text() == 'Unrelated previous evidence'


def test_asset_evidence_cases_do_not_delete_or_write_fixed_repository_paths():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2] / "frontend" / "tests"
    for name in ("assets-golden-evidence.spec.ts", "assets-stage33-evidence.spec.ts", "assets-stage34-evidence.spec.ts", "assets-stage35-evidence.spec.ts", "assets-stage36-evidence.spec.ts"):
        source = (root / name).read_text()
        assert "testInfo.outputPath(" in source, name
        assert "fs.rm(CAPTURE_DIR" not in source, name
        assert "path.resolve(process.cwd(), 'stage" not in source, name
        assert "path.resolve(process.cwd(), 'OUT-26_" not in source, name


def test_role_matrix_is_explicit_and_uses_separate_non_admin_identities():
    runtime = (ROOT / 'scripts/lib/verify-runtime.sh').read_text()
    assert 'role-matrix)' in runtime
    assert "sysgrid.verify.viewer" in runtime and "sysgrid.verify.editor" in runtime
    assert 'if [[ "$VERIFY_RUNTIME_PROFILE" == "role-matrix" ]]; then resolved_runtime_user=""; fi' in runtime
    assert 'is_admin=False' in runtime
    assert 'role-matrix' in (ROOT / 'frontend/playwright.role-matrix.config.ts').read_text()
