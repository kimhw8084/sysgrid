"""Node qualification uses the declared engine and rejects unsafe overrides."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


LIBRARY = Path(__file__).resolve().parents[1] / 'lib/verify-runtime.sh'


def make_node(directory: Path, version: str) -> Path:
    directory.mkdir(parents=True)
    node = directory / 'node'
    node.write_text(f"#!/bin/sh\nprintf '%s\\n' '{version}'\n")
    node.chmod(0o700)
    return node


def resolve(path: str, **overrides: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop('NODE_BIN', None)
    env.pop('SYSGRID_VERIFY_NODE', None)
    env.update(PATH=path, **overrides)
    script = '''
source "$1"
verify_runtime_resolve_node
printf 'SELECTED=%s\\n' "$NODE_BIN"
printf 'PATH_NODE=%s\\n' "$(command -v node)"
printf 'PATH_VERSION=%s\\n' "$(node --version)"
'''
    return subprocess.run(['/bin/bash', '-c', script, 'test', str(LIBRARY)], env=env, text=True, capture_output=True, timeout=10)


@pytest.mark.parametrize('version', ['v20.19.4', 'v22.12.99', 'v22.13.0-rc.1', 'v23.0.0', 'not-node'])
def test_explicit_unsupported_override_fails_without_falling_back(tmp_path, version):
    rejected = make_node(tmp_path / 'rejected', version)
    supported = make_node(tmp_path / 'supported', 'v22.23.2')
    result = resolve(str(supported.parent) + os.pathsep + os.defpath, SYSGRID_VERIFY_NODE=str(rejected))
    assert result.returncode != 0
    assert 'SELECTED=' not in result.stdout
    assert 'Node >=22.13.0 <23' in result.stderr


@pytest.mark.parametrize('version', ['v22.13.0', 'v22.23.2'])
def test_supported_override_controls_nested_node_path(tmp_path, version):
    previous = make_node(tmp_path / 'previous', 'v20.19.4')
    supported = make_node(tmp_path / 'supported', version)
    result = resolve(str(previous.parent) + os.pathsep + os.defpath, SYSGRID_VERIFY_NODE=str(supported))
    assert result.returncode == 0, result.stderr
    assert f'SELECTED={supported}' in result.stdout
    assert f'PATH_NODE={supported}' in result.stdout
    assert f'PATH_VERSION={version}' in result.stdout


def test_preselected_node_bin_has_precedence_and_is_still_validated(tmp_path):
    selected = make_node(tmp_path / 'selected', 'v22.13.0')
    alternate = make_node(tmp_path / 'alternate', 'v22.23.2')
    result = resolve(str(alternate.parent) + os.pathsep + os.defpath, NODE_BIN=str(selected), SYSGRID_VERIFY_NODE=str(alternate))
    assert result.returncode == 0, result.stderr
    assert f'SELECTED={selected}' in result.stdout
    assert 'PATH_VERSION=v22.13.0' in result.stdout


def test_invalid_preselected_node_bin_never_falls_through_to_override(tmp_path):
    rejected = make_node(tmp_path / 'rejected', 'v20.19.4')
    supported = make_node(tmp_path / 'supported', 'v22.23.2')
    result = resolve(str(supported.parent) + os.pathsep + os.defpath, NODE_BIN=str(rejected), SYSGRID_VERIFY_NODE=str(supported))
    assert result.returncode != 0
    assert 'SELECTED=' not in result.stdout


def test_path_discovery_skips_unsupported_candidates(tmp_path):
    rejected = make_node(tmp_path / 'rejected', 'v20.19.4')
    supported = make_node(tmp_path / 'supported', 'v22.23.2')
    result = resolve(os.pathsep.join([str(rejected.parent), str(supported.parent), os.defpath]))
    assert result.returncode == 0, result.stderr
    assert f'SELECTED={supported}' in result.stdout
    assert f'PATH_NODE={supported}' in result.stdout
    assert 'PATH_VERSION=v22.23.2' in result.stdout


def test_real_verifier_rejects_unsupported_node_before_touching_evidence(tmp_path):
    repo = Path(__file__).resolve().parents[2]
    script = tmp_path / 'scripts/verify-app.sh'
    script.parent.mkdir(parents=True)
    (tmp_path / 'scripts/lib').mkdir()
    shutil.copyfile(repo / 'scripts/verify-app.sh', script)
    shutil.copyfile(LIBRARY, tmp_path / 'scripts/lib/verify-runtime.sh')
    evidence = tmp_path / 'backend/test-results/prior-evidence'
    evidence.parent.mkdir(parents=True)
    evidence.write_text('Keep this evidence')
    rejected = make_node(tmp_path / 'rejected', 'v20.19.4')
    env = os.environ.copy()
    env.pop('SYSGRID_VERIFY_SHARD', None)
    env.pop('SYSGRID_VERIFY_NODE', None)
    env.update(PYTHON_BIN=sys.executable, NODE_BIN=str(rejected), PATH=str(rejected.parent) + os.pathsep + os.defpath)
    result = subprocess.run(['/bin/bash', str(script), '--stage', 'checks'], env=env, text=True, capture_output=True, timeout=10)
    assert result.returncode != 0
    assert 'Node >=22.13.0 <23' in result.stderr
    assert evidence.read_text() == 'Keep this evidence'
