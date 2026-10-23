"""Fail closed unless isolated Playwright shards exactly cover the full selection."""
import hashlib
import json
import os
import sys
from pathlib import Path


LEGACY_SKIPS = {
    'keeps knowledge, research, and projects CRUD durable through read-update-delete cycles',
    'keeps network, external, and FAR CRUD flows stable with realistic payloads',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def cases(report):
    require(report['errors'] == [], 'Playwright reported global errors')
    result = {}

    def visit(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                key = spec['id'] + ':' + test['projectId']
                require(key not in result, 'Duplicate test identity within one report')
                result[key] = (spec['title'], test)
        for child in suite.get('suites', []):
            visit(child)

    for suite in report['suites']:
        visit(suite)
    require(bool(result), 'Empty browser selection')
    return result


def verify(root, env):
    require(env['QUALIFICATION_RESULT'] == 'success', 'A qualification runner did not succeed')
    candidate, trigger, run_id = env['CANDIDATE_SHA'], env['GITHUB_SHA'], int(env['GITHUB_RUN_ID'])
    folders = sorted(root.iterdir())
    expected_folders = {f'application-ci-normal-v1-{index}-evidence-{candidate}' for index in range(1, 4)}
    require({path.name for path in folders} == expected_folders, 'Missing or unexpected shard artifact')
    selection = None
    identities, covered, skipped, inventory = [], {}, {}, []
    for index in range(1, 4):
        folder = root / f'application-ci-normal-v1-{index}-evidence-{candidate}'
        names = ['ci-identity.json', 'frontend-test-results/normal-v1-selection.json',
                 'frontend-test-results/normal-v1-results.json']
        identity, listed, report = [json.loads((folder / name).read_bytes()) for name in names]
        require(identity['candidate_sha'] == candidate and identity['github_sha'] == identity['tested_trigger_sha'] == trigger,
                'Candidate or tested trigger mismatch')
        require(identity['workflow_run_id'] == run_id and identity['event'] == env['GITHUB_EVENT_NAME'], 'Run/event mismatch')
        require(identity['ref'] == env['GITHUB_REF'] and identity['qualification_stage'] == 'normal-v1', 'Ref/stage mismatch')
        require(identity['qualification_result'] == 'success' and identity['qualification_shard'] == f'{index}/3',
                'Unsuccessful or mislabeled shard')
        if identities:
            for field in ['candidate_base_sha', 'pr_base_sha', 'head_ref', 'repository', 'workflow_name']:
                require(identity[field] == identities[0][field], 'Shard provenance mismatch: ' + field)
        current = {key: title for key, (title, _) in cases(listed).items()}
        require(selection is None or selection == current, 'Shards disagree on the full unfiltered selection')
        selection = current
        require(report['config']['workers'] == 1 and all(project['retries'] == 0 for project in report['config']['projects']),
                'Browser worker/retry contract changed')
        require(report['config']['shard'] == {'current': index, 'total': 3}, 'Incorrect actual Playwright shard')
        actual = cases(report)
        require(not covered.keys() & actual.keys(), 'Browser shard overlap')
        require(actual.keys() <= selection.keys(), 'Executed test is outside the full selection')
        for key, (title, test) in actual.items():
            require(title == selection[key] and len(test['results']) == 1, 'Test identity/result count mismatch')
            result = test['results'][0]
            require(result['retry'] == 0 and result['errors'] == [], 'Retried or failed browser result')
            if result['status'] == 'skipped':
                require(title in LEGACY_SKIPS and test['expectedStatus'] == 'skipped', 'Unexpected browser skip')
                skipped[key] = title
            else:
                require(result['status'] == test['expectedStatus'] == 'passed' and test['status'] == 'expected',
                        'Browser case did not pass on its first attempt')
        covered.update(actual)
        identities.append(identity)
        for name in names:
            raw = (folder / name).read_bytes()
            inventory.append({'path': folder.name + '/' + name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    require(covered.keys() == selection.keys(), 'Browser shards omitted selected tests')
    require(len(skipped) == 2 and set(skipped.values()) == LEGACY_SKIPS, 'Historical skip inventory changed')
    return {
        **identities[0], 'schema_version': 'sysgrid.application-ci.browser-union.v1',
        'qualification_shard': None, 'shards': ['1/3', '2/3', '3/3'],
        'full_selection_count': len(selection), 'passed': len(covered) - len(skipped),
        'skipped_titles': sorted(skipped.values()), 'unexpected': 0, 'flaky': 0,
        'selection_sha256': hashlib.sha256(json.dumps(selection, sort_keys=True).encode()).hexdigest(),
        'original_reports': inventory,
    }


if __name__ == '__main__':
    require(len(sys.argv) == 3, 'Usage: verify-ci-shards.py INPUT_DIRECTORY OUTPUT_DIRECTORY')
    proof = verify(Path(sys.argv[1]), os.environ)
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    (output / 'ci-identity.json').write_text(json.dumps(proof, indent=2, sort_keys=True) + '\n')
    print(f"Verified complete browser union: {proof['passed']} passed, {len(proof['skipped_titles'])} historical skips; no overlap, omissions or retries.")
