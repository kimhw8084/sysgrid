"""The required browser gate rejects incomplete, overlapping or stale evidence."""
import copy
import importlib.util
import json
from pathlib import Path

import pytest


SPEC = importlib.util.spec_from_file_location('ci_shards', Path(__file__).resolve().parents[1] / 'verify-ci-shards.py')
SHARDS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SHARDS)


@pytest.fixture
def evidence(tmp_path):
    env = {'QUALIFICATION_RESULT': 'success', 'CANDIDATE_SHA': 'a' * 40, 'GITHUB_SHA': 'b' * 40,
           'GITHUB_RUN_ID': '123', 'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_REF': 'refs/pull/54/merge'}
    titles = ['first', 'second', 'third']

    def report(indices, shard=None, executed=False):
        specs = []
        for index in indices:
            test = {'projectId': '', 'expectedStatus': 'passed', 'status': 'expected', 'results': []}
            if executed:
                test['results'] = [{'retry': 0, 'errors': [], 'status': 'passed'}]
            specs.append({'id': str(index), 'title': titles[index], 'tests': [test]})
        return {'errors': [], 'suites': [{'specs': specs}],
                'config': {'workers': 1, 'projects': [{'retries': 0}], 'shard': {'current': shard, 'total': 3}}}

    for index, indices in enumerate([[0], [1], [2]], 1):
        folder = tmp_path / f"application-ci-normal-v1-{index}-evidence-{env['CANDIDATE_SHA']}"
        (folder / 'frontend-test-results').mkdir(parents=True)
        identity = {'candidate_sha': env['CANDIDATE_SHA'], 'github_sha': env['GITHUB_SHA'],
                    'tested_trigger_sha': env['GITHUB_SHA'], 'workflow_run_id': 123, 'event': env['GITHUB_EVENT_NAME'],
                    'ref': env['GITHUB_REF'], 'qualification_stage': 'normal-v1', 'qualification_result': 'success',
                    'qualification_shard': f'{index}/3', 'candidate_base_sha': 'c' * 40, 'pr_base_sha': 'c' * 40,
                    'head_ref': 'candidate', 'repository': 'test/sysgrid', 'workflow_name': 'Application CI'}
        for name, value in [('ci-identity.json', identity),
                            ('frontend-test-results/normal-v1-selection.json', report(range(3))),
                            ('frontend-test-results/normal-v1-results.json', report(indices, index, True))]:
            (folder / name).write_text(json.dumps(value))

    def mutate(name, change, index=1):
        path = tmp_path / f"application-ci-normal-v1-{index}-evidence-{env['CANDIDATE_SHA']}" / name
        value = json.loads(path.read_bytes())
        change(value)
        path.write_text(json.dumps(value))

    return tmp_path, env, mutate


def test_accepts_only_complete_first_attempt_union_and_retains_report_hashes(evidence):
    root, env, _ = evidence
    proof = SHARDS.verify(root, env)
    assert proof['full_selection_count'] == 3 and proof['passed'] == 3
    assert proof['skipped_titles'] == []
    assert len(proof['original_reports']) == 9
    assert proof['unexpected'] == proof['flaky'] == 0
    assert proof['candidate_sha'] == env['CANDIDATE_SHA'] and proof['qualification_shard'] is None


@pytest.mark.parametrize('field,value', [('candidate_sha', 'wrong'), ('tested_trigger_sha', 'wrong'),
    ('github_sha', 'wrong'), ('workflow_run_id', 122), ('event', 'push'), ('ref', 'refs/heads/main'),
    ('qualification_stage', 'desktop'), ('qualification_result', 'cancelled'), ('qualification_shard', '2/3'),
    ('candidate_base_sha', 'wrong'), ('pr_base_sha', 'wrong'), ('head_ref', 'wrong'), ('repository', 'wrong'),
    ('workflow_name', 'wrong')])
def test_rejects_stale_mislabeled_or_unsuccessful_shard_identity(evidence, field, value):
    root, env, mutate = evidence
    mutate('ci-identity.json', lambda item: item.update({field: value}))
    with pytest.raises(ValueError):
        SHARDS.verify(root, env)


@pytest.mark.parametrize('outcome', ['failure', 'cancelled', 'skipped', ''])
def test_rejects_unsuccessful_matrix_before_reading_reports(evidence, outcome):
    root, env, _ = evidence
    env['QUALIFICATION_RESULT'] = outcome
    with pytest.raises(ValueError):
        SHARDS.verify(root, env)


@pytest.mark.parametrize('change', [
    lambda item: item['suites'][0]['specs'].pop(0),
    lambda item: item['suites'][0]['specs'].append(copy.deepcopy(item['suites'][0]['specs'][0])),
    lambda item: item['errors'].append({'message': 'global failure'}),
    lambda item: item['config'].update(workers=2),
    lambda item: item['config']['projects'][0].update(retries=1),
    lambda item: item['config'].update(shard={'current': 2, 'total': 3}),
    lambda item: item['suites'][0]['specs'][0].update(id='not-selected'),
    lambda item: item['suites'][0]['specs'][0].update(title='changed identity'),
    lambda item: item['suites'][0]['specs'][0]['tests'][0].update(expectedStatus='failed'),
    lambda item: item['suites'][0]['specs'][0]['tests'][0]['results'][0].update(status='failed'),
    lambda item: item['suites'][0]['specs'][0]['tests'][0]['results'][0].update(retry=1),
    lambda item: item['suites'][0]['specs'][0]['tests'][0]['results'][0]['errors'].append({'message': 'failure'}),
    lambda item: item['suites'][0]['specs'][0]['tests'][0]['results'].clear(),
    lambda item: item['suites'][0]['specs'][0]['tests'][0]['results'].append({'status': 'passed'}),
    lambda item: item['suites'][0]['specs'][0]['tests'][0].update(expectedStatus='skipped', results=[{'retry': 0, 'errors': [], 'status': 'skipped'}]),
])
def test_rejects_omission_duplicates_errors_retries_and_unapproved_skips(evidence, change):
    root, env, mutate = evidence
    mutate('frontend-test-results/normal-v1-results.json', change)
    with pytest.raises(ValueError):
        SHARDS.verify(root, env)


def test_rejects_disagreeing_full_selections(evidence):
    root, env, mutate = evidence
    mutate('frontend-test-results/normal-v1-selection.json', lambda item: item['suites'][0]['specs'].pop())
    with pytest.raises(ValueError):
        SHARDS.verify(root, env)


def test_rejects_cross_shard_overlap(evidence):
    root, env, mutate = evidence
    folder = root / f"application-ci-normal-v1-1-evidence-{env['CANDIDATE_SHA']}"
    case = json.loads((folder / 'frontend-test-results/normal-v1-results.json').read_bytes())['suites'][0]['specs'][0]
    mutate('frontend-test-results/normal-v1-results.json', lambda item: item['suites'][0]['specs'].append(case), index=2)
    with pytest.raises(ValueError, match='overlap'):
        SHARDS.verify(root, env)


def test_rejects_any_skipped_browser_case(evidence):
    root, env, mutate = evidence
    def mark_skipped(item):
        test = item['suites'][0]['specs'][0]['tests'][0]
        test.update(expectedStatus='skipped', status='skipped',
                    results=[{'retry': 0, 'errors': [], 'status': 'skipped'}])
    mutate('frontend-test-results/normal-v1-results.json', mark_skipped)
    with pytest.raises(ValueError, match='Unexpected browser skip'):
        SHARDS.verify(root, env)


@pytest.mark.parametrize('name', ['ci-identity.json', 'frontend-test-results/normal-v1-selection.json',
                                'frontend-test-results/normal-v1-results.json'])
def test_rejects_missing_original_proof(evidence, name):
    root, env, _ = evidence
    (root / f"application-ci-normal-v1-1-evidence-{env['CANDIDATE_SHA']}" / name).unlink()
    with pytest.raises(FileNotFoundError):
        SHARDS.verify(root, env)


def test_rejects_missing_shard_even_if_other_reports_are_valid(evidence):
    root, env, _ = evidence
    folder = root / f"application-ci-normal-v1-3-evidence-{env['CANDIDATE_SHA']}"
    folder.rename(root / 'wrong-artifact')
    with pytest.raises(ValueError, match='artifact'):
        SHARDS.verify(root, env)
