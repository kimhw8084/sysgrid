"""Exercise real Git repositories, files and listeners; never use operator data."""
import os
from pathlib import Path
import socket
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / 'scripts/lib/safe-startup.sh'


def shell(body, *args, env=None):
    return subprocess.run(['bash', '-euc', 'source "$1"; ' + body, 'test', str(LIBRARY), *map(str, args)], capture_output=True, text=True, env=env)


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


@pytest.fixture
def repositories(tmp_path):
    remote, author, work = [tmp_path / name for name in ('remote.git', 'author', 'work')]
    remote.mkdir()
    git(remote, 'init', '--bare', '--initial-branch=main')
    author.mkdir()
    git(author, 'init', '--initial-branch=main')
    git(author, 'config', 'user.email', 'fixture@sysgrid.test')
    git(author, 'config', 'user.name', 'Startup fixture')
    (author / 'tracked.txt').write_text('original\n')
    git(author, 'add', 'tracked.txt')
    git(author, 'commit', '-m', 'fixture base')
    git(author, 'remote', 'add', 'origin', str(remote))
    git(author, 'push', 'origin', 'main')
    git(tmp_path, 'clone', str(remote), str(work))
    git(work, 'config', 'user.email', 'fixture@sysgrid.test')
    git(work, 'config', 'user.name', 'Startup fixture')
    (author / 'tracked.txt').write_text('remote update\n')
    git(author, 'add', 'tracked.txt')
    git(author, 'commit', '-m', 'fixture remote advance')
    git(author, 'push', 'origin', 'main')
    return author, work


def test_clean_main_fast_forwards_without_creating_a_commit(repositories):
    author, work = repositories
    result = shell('sysgrid_sync_main "$2"', work)
    assert result.returncode == 0, result.stderr
    assert git(work, 'rev-parse', 'HEAD') == git(author, 'rev-parse', 'HEAD')
    assert (work / 'tracked.txt').read_text() == 'remote update\n'


@pytest.mark.parametrize('condition', ['modified', 'staged', 'untracked', 'branch', 'detached', 'diverged'])
def test_sync_refusal_preserves_local_work(repositories, condition):
    _, work = repositories
    if condition in {'modified', 'staged', 'diverged'}:
        (work / 'tracked.txt').write_text('valuable local work\n')
    if condition in {'staged', 'diverged'}:
        git(work, 'add', 'tracked.txt')
    if condition == 'diverged':
        git(work, 'commit', '-m', 'local work')
    if condition == 'untracked':
        (work / 'precious.txt').write_text('untracked data')
    if condition == 'branch':
        git(work, 'switch', '-c', 'feature')
    if condition == 'detached':
        git(work, 'checkout', '--detach')
    before = {name: git(work, *args) for name, args in {
        'head': ('rev-parse', 'HEAD'), 'status': ('status', '--porcelain=v1'),
        'index': ('diff', '--cached'), 'diff': ('diff',), 'branch': ('branch', '--show-current'),
    }.items()}
    contents = {p.name: p.read_bytes() for p in work.iterdir() if p.is_file()}
    result = shell('sysgrid_sync_main "$2"', work)
    assert result.returncode != 0
    assert 'Refusing synchronization' in result.stderr
    assert git(work, 'rev-parse', 'HEAD') == before['head']
    assert git(work, 'status', '--porcelain=v1') == before['status']
    assert git(work, 'diff', '--cached') == before['index']
    assert git(work, 'diff') == before['diff']
    assert git(work, 'branch', '--show-current') == before['branch']
    assert {p.name: p.read_bytes() for p in work.iterdir() if p.is_file()} == contents


@pytest.mark.parametrize('existing', ['none', 'both', 'config_only', 'tenant_only', 'unknown_tenant_file'])
def test_data_preflight_never_modifies_existing_files(tmp_path, existing):
    config, tenant_root = tmp_path / 'config.db', tmp_path / 'tenants'
    tenant = tenant_root / 'local_demo.db'
    if existing in {'both', 'config_only'}:
        config.write_bytes(b'valuable config')
    if existing in {'both', 'tenant_only', 'unknown_tenant_file'}:
        tenant_root.mkdir()
        (tenant if existing != 'unknown_tenant_file' else tenant_root / 'other.db').write_bytes(b'valuable tenant')
    before = {str(p): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    result = shell('sysgrid_local_data_action preserve "$2" "$3" "$4"', config, tenant, tenant_root)
    if existing in {'none', 'both'}:
        assert result.returncode == 0
        assert result.stdout.strip() == ('initialize' if existing == 'none' else 'preserve')
    else:
        assert result.returncode != 0
        assert 'will not overwrite' in result.stderr
    assert {str(p): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()} == before


def test_explicit_reset_retains_entire_dataset_and_sqlite_sidecars(tmp_path):
    config, tenant_root = tmp_path / 'config.db', tmp_path / 'tenants'
    tenant_root.mkdir()
    original = {config: b'config', Path(str(config) + '-wal'): b'wal', Path(str(config) + '-shm'): b'shm', tenant_root / 'one.db': b'one', tenant_root / 'extra.txt': b'keep this too'}
    for path, data in original.items():
        path.write_bytes(data)
    backups = tmp_path / 'archives'
    result = shell('sysgrid_archive_local_data "$2" "$3" "$4"', config, tenant_root, backups)
    assert result.returncode == 0, result.stderr
    archive, = backups.iterdir()
    assert {str(p.relative_to(archive)): p.read_bytes() for p in archive.rglob('*') if p.is_file()} == {str(p.relative_to(tmp_path)): data for p, data in original.items()}
    assert not config.exists() and not tenant_root.exists()


def test_busy_listener_is_not_terminated():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        port = listener.getsockname()[1]
        result = shell('sysgrid_require_free_port "$2"', port)
        assert result.returncode != 0
        assert 'will not terminate' in result.stderr
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            pass


@pytest.mark.parametrize('args', [[], ['--seed-data'], ['--no-seed-data']])
def test_launch_options_do_not_implicitly_reset(args):
    env = {key: value for key, value in os.environ.items() if key not in {'DATA_MODE', 'SEED_DOMAIN_DATA'}}
    env['SYSGRID_SKIP_WORKSTATION_SELF_TEST'] = '1'
    result = subprocess.run(['bash', str(ROOT / 'scripts/start-local.sh'), *args, '--print-runtime-config'], env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert 'Data mode:                preserve' in result.stdout


def test_environment_cannot_implicitly_reset():
    result = subprocess.run(['bash', str(ROOT / 'scripts/start-local.sh'), '--print-runtime-config'], env={**os.environ, 'DATA_MODE': 'reset'}, text=True, capture_output=True)
    assert result.returncode != 0
    assert 'explicit --reset-data' in result.stderr


def test_legacy_fresh_profile_defaults_to_resume_without_editing_profile(tmp_path):
    config = tmp_path / 'config'
    profile = config / 'sysgrid/workstations/work.env'
    profile.parent.mkdir(parents=True)
    profile.write_text('DEFAULT_DATA_MODE=fresh-full\nAPI_BASE_URL=http://127.0.0.1:8000\nFRONTEND_ORIGIN=http://127.0.0.1:5173\nRUNTIME_EFFECTIVE_USER_ID=startup-fixture\n')
    original = profile.read_bytes()
    env = {key: value for key, value in os.environ.items() if not key.startswith('SYSGRID_')}
    env.update(XDG_CONFIG_HOME=str(config), XDG_STATE_HOME=str(tmp_path / 'state'))
    result = subprocess.run(['bash', str(ROOT / 'scripts/workstation-up.sh'), '--print-config'], env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert 'Selected data mode:          resume' in result.stdout
    assert profile.read_bytes() == original
