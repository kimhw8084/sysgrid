#!/usr/bin/env python3
"""Offline company qualification: retain evidence internally; return one short code."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
ORDER = 'SCFADORIVJPLUH'
NO_CHANGE_PATCH = b''
NO_CHANGE_PATCH_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
CRITICAL = ('scripts/company-probe.py', 'scripts/production-preflight.py', 'scripts/production-operations.py',
    'scripts/production-lifecycle.py', 'scripts/production_data_guard.py', 'scripts/rehearse-production-lifecycle.py',
    'backend/app/core/config.py', 'backend/app/runtime_diagnostics.py', 'backend/requirements.lock',
    'frontend/package-lock.json', 'frontend/vite.config.ts')
FORBIDDEN = re.compile(rb'(?im)^\s*(?:rtk\s+proxy\s+)?(?:codex|opencode|chatgpt|claude|gemini|aider|ollama)(?:\s|$)|api\.openai\.com|\bgit\s+(?:commit|push|reset|clean|stash)\b|(?:^|\s)--fix(?:\s|$)')
MANUAL = {
    'I': 'Two real identities: correct tenant isolation, viewer write rejection, sign-out/expiry, revocation and gateway/header-bypass rejection were observed.',
    'V': 'An approved test record survived actual restart/redeploy on the persistent volume; isolated recovery met agreed recovery-point/time targets.',
    'J': 'The platform scheduler ran health checks/backups; a deliberate failure or missing run delivered its alert to the responsible operator.',
    'P': 'Every live provider/action included in this release was verified, including credential custody and recovery. Answer n/a only for a registry-only release with live actions gated.',
    'L': 'Representative company workload at the promised user/estate size met agreed p95/error/resource budgets, including contention and a sustained session.',
    'U': 'All eight V1 workspaces completed representative tasks in both themes, short desktop windows, keyboard navigation, 200% zoom and the supported assistive technology.',
    'H': 'Real engineers completed the pilot and explicitly accepted correctness, task completion and recovery; record their anonymous participant count below.',
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def source_fingerprint(root: Path, backend: bool = False) -> str:
    digest = hashlib.sha256()
    files = [path for path in root.rglob('*') if path.is_file() and not path.is_symlink()
        and (path.suffix == '.py' if backend else '.test.' not in path.name)]
    for path in sorted(files):
        digest.update(path.relative_to(root).as_posix().encode() + b'\0' + path.read_bytes() + b'\0')
    return digest.hexdigest()


def git(*args: str, data: bytes | None = None) -> bytes:
    result = subprocess.run(['git', *args], cwd=ROOT, input=data, capture_output=True, timeout=20)
    if result.returncode: raise ValueError('SOURCE_COMMAND_FAILED')
    return result.stdout


def verify_source(head: str, probe_sha: str) -> dict[str, str]:
    if not re.fullmatch('[0-9a-f]{40}', head) or not re.fullmatch('[0-9a-f]{64}', probe_sha):
        raise ValueError('SOURCE_IDENTITY_INVALID')
    if git('branch', '--show-current').strip() != b'main' or git('rev-parse', 'HEAD').decode().strip() != head:
        raise ValueError('SOURCE_HEAD_MISMATCH')
    if git('status', '--porcelain=v1', '-uall').strip(): raise ValueError('SOURCE_DIRTY')
    if sha(Path(__file__).read_bytes()) != probe_sha: raise ValueError('PROBE_HASH_MISMATCH')
    hashes = {}
    for name in CRITICAL:
        raw = (ROOT / name).read_bytes()
        if sha(raw) != sha(git('show', head + ':' + name)): raise ValueError('SOURCE_FILE_MISMATCH')
        if name.startswith('scripts/') and FORBIDDEN.search(raw): raise ValueError('RUNNER_SAFETY_FAILED')
        hashes[name] = sha(raw)
    if sha(NO_CHANGE_PATCH) != NO_CHANGE_PATCH_SHA256: raise ValueError('PATCH_HASH_MISMATCH')
    git('apply', '--allow-empty', '--check', '-', data=NO_CHANGE_PATCH)
    git('apply', '--allow-empty', '-', data=NO_CHANGE_PATCH)
    if git('rev-parse', 'HEAD').decode().strip() != head or git('status', '--porcelain=v1', '-uall').strip():
        raise ValueError('SOURCE_CHANGED')
    if any(sha((ROOT / name).read_bytes()) != digest for name, digest in hashes.items()): raise ValueError('SOURCE_CHANGED')
    return hashes


def origin(value: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {'', '/'}:
        raise ValueError('HTTPS_ORIGIN_REQUIRED')
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_json(url: str) -> dict:
    # Only explicitly approved company origins are called. No proxy discovery,
    # redirects, downloads, telemetry or public service calls are performed.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'Cache-Control': 'no-cache'})
    with opener.open(request, timeout=8) as response:
        raw = response.read(262145)
    if len(raw) > 262144: raise ValueError('RESPONSE_TOO_LARGE')
    result = json.loads(raw)
    if not isinstance(result, dict): raise ValueError('INVALID_RESPONSE')
    return result


def command_report(script: str, args: list[str], timeout: int) -> dict:
    result = subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *args], cwd=ROOT,
        capture_output=True, timeout=timeout)
    try: report = json.loads(result.stdout)
    except (ValueError, UnicodeError): report = {'status': 'FAIL', 'reason': 'REPORT_UNAVAILABLE'}
    if not isinstance(report, dict): report = {'status': 'FAIL', 'reason': 'REPORT_UNAVAILABLE'}
    return {'exit_code': result.returncode, 'report': report}


def storage_check() -> dict:
    sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'scripts')]
    from app.core.config import Settings
    import production_data_guard as guard
    configured = Settings(_env_file=None)
    if not configured.is_production or configured.production_guard_errors(): raise ValueError('CONFIGURATION_NOT_QUALIFIED')
    inventory = guard.discover_database_inventory(config_db_url=configured.CONFIG_DATABASE_URL,
        default_db_url=configured.DATABASE_URL, backend_root=ROOT / 'backend')['databases']
    if not inventory or len(inventory) > 100: raise ValueError('DATABASE_BOUND')
    parents = set()
    for entry in inventory:
        path = entry['source_path'].resolve()
        if path.is_relative_to(ROOT) or not path.is_file(): raise ValueError('STORAGE_MUST_BE_OUTSIDE_CHECKOUT')
        parents.add(path.parent)
    for parent in parents:
        with tempfile.TemporaryFile(dir=parent, prefix='.sysgrid-probe-') as scratch:
            marker = os.urandom(8192)
            scratch.write(marker)
            scratch.flush()
            os.fsync(scratch.fileno())
            scratch.seek(0)
            if scratch.read() != marker: raise ValueError('STORAGE_READBACK_FAILED')
    return {'database_count': len(inventory), 'outside_checkout': True, 'scratch_write_fsync_readback': True,
        'boundary': 'Actual restart/redeploy durability still requires V.'}


def short_code(report: dict) -> str:
    statuses = ''.join(report['checks'][key]['status'] for key in ORDER)
    if not re.fullmatch('[PFUAN]{14}', statuses): raise ValueError('INVALID_STATUS_VECTOR')
    digest = sha(json.dumps(report, sort_keys=True, separators=(',', ':')).encode())[:8]
    body = f"SG1-{report['head'][:8]}-{report['probe_sha256'][:8]}-{statuses}-{digest}"
    return body + '-' + f'{zlib.crc32(body.encode()) & 0xffff:04x}'


def decode_code(value: str) -> dict:
    match = re.fullmatch(r'SG1-([0-9a-f]{8})-([0-9a-f]{8})-([PFUAN]{14})-([0-9a-f]{8})-([0-9a-f]{4})', value.strip(), re.I)
    if not match: raise ValueError('SUMMARY_FORMAT_INVALID')
    head, probe, statuses, digest, checksum = match.groups()
    body = f'SG1-{head.lower()}-{probe.lower()}-{statuses.upper()}-{digest.lower()}'
    if checksum.lower() != f'{zlib.crc32(body.encode()) & 0xffff:04x}': raise ValueError('SUMMARY_COPY_CHECK_FAILED')
    return {'head_prefix': head.lower(), 'probe_prefix': probe.lower(), 'checks': dict(zip(ORDER, statuses.upper())),
        'internal_report_digest_prefix': digest.lower(), 'evidence_type': 'manually_transcribed_company_summary', 'production_accepted': False}


def package(folder: Path, report: dict) -> str:
    folder.mkdir(parents=True, mode=0o700)
    raw = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode()
    code = short_code(report)
    files = {'report.json': raw, 'SUMMARY.txt': (code + '\n').encode()}
    manifest = json.dumps({'files': [{'path': name, 'bytes': len(value), 'sha256': sha(value)} for name, value in sorted(files.items())]}, sort_keys=True).encode()
    target = folder / 'UPLOAD_THIS_TO_CHATGPT.zip'
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items(): archive.writestr(name, value)
        archive.writestr('manifest.json', manifest)
    target.chmod(0o600)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != 3: raise ValueError('PACKAGE_INVALID')
        for name, value in files.items():
            if sha(archive.read(name)) != sha(value): raise ValueError('PACKAGE_INVALID')
        if archive.read('manifest.json') != manifest: raise ValueError('PACKAGE_INVALID')
    (folder / 'SUMMARY.txt').write_text(code + '\n')
    (folder / 'SUMMARY.txt').chmod(0o600)
    (folder / 'report.json').write_bytes(raw)
    (folder / 'report.json').chmod(0o600)
    return code


def main(argv: list[str] | None = None) -> int:
    if sys.version_info < (3, 12):
        print('SG1-STOP-PYTHON_REQUIRES_3_12_OR_NEWER')
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--probe-sha', required=True)
    parser.add_argument('--url', help='Company frontend HTTPS origin; prompted when interactive')
    parser.add_argument('--api-url', help='Company backend HTTPS origin; blank means same origin')
    parser.add_argument('--output', type=Path, required=True, help='New evidence directory outside the checkout')
    parser.add_argument('--attest', action='store_true', help='Record actual operator observations; blank answers stay unverified')
    args = parser.parse_args(argv)
    try:
        hashes = verify_source(args.expected_head, args.probe_sha)
        output = args.output.expanduser().resolve()
        if output.exists() or output.is_relative_to(ROOT): raise ValueError('NEW_EXTERNAL_OUTPUT_REQUIRED')
    except (OSError, ValueError, subprocess.SubprocessError):
        print('SG1-STOP-SOURCE_OR_OUTPUT_MISMATCH')
        return 2
    checks = {key: {'status': 'U', 'reason': 'NOT_OBSERVED'} for key in ORDER}
    checks['S'] = {'status': 'P', 'reason': 'EXACT_CLEAN_SOURCE_AND_EMPTY_PATCH_VERIFIED'}
    runtime_source_before = {'backend': source_fingerprint(ROOT / 'backend/app', backend=True),
        'frontend': source_fingerprint(ROOT / 'frontend/src')}
    details = {}
    def observe(key, operation):
        try:
            value = operation()
            details[key] = value
            passed = value.get('exit_code') == 0 and value.get('report', {}).get('status') == 'PASS' if 'exit_code' in value else value.get('status', 'PASS') == 'PASS'
            checks[key] = {'status': 'P' if passed else 'F', 'reason': 'CHECK_COMPLETE' if passed else 'CHECK_FAILED'}
        except urllib.error.HTTPError as exc:
            checks[key] = {'status': 'U' if key in {'F', 'A'} and exc.code in {301, 302, 303, 307, 308, 401, 403} else 'F',
                'reason': 'BROWSER_AUTH_REQUIRED' if exc.code in {301, 302, 303, 307, 308, 401, 403} else 'HTTP_' + str(exc.code)}
        except (OSError, ValueError, ImportError, subprocess.SubprocessError) as exc:
            reason = str(exc) if isinstance(exc, ValueError) and re.fullmatch('[A-Z0-9_]{1,64}', str(exc)) else type(exc).__name__
            checks[key] = {'status': 'F', 'reason': reason}
        except Exception as exc:
            checks[key] = {'status': 'F', 'reason': type(exc).__name__}
    observe('C', lambda: command_report('production-preflight.py', ['--config-only', '--json'], 30))
    if checks['C']['status'] == 'P':
        observe('D', storage_check)
        observe('O', lambda: command_report('production-operations.py', [], 240))
    observe('R', lambda: command_report('rehearse-production-lifecycle.py', [], 180))
    address = args.url
    if not address and sys.stdin.isatty(): address = input('Company frontend HTTPS origin (blank = not deployed): ').strip()
    if address:
        try:
            frontend = origin(address)
            backend = origin(args.api_url) if args.api_url else frontend
            tag = os.urandom(6).hex()
            def frontend_identity():
                value = fetch_json(frontend + '/sysgrid-build.json?probe=' + tag)
                if value.get('schema_version') != 1 or value.get('source_sha256') != source_fingerprint(ROOT / 'frontend/src'):
                    raise ValueError('FRONTEND_BUILD_MISMATCH')
                if value.get('identity_mode') not in {'environment', 'trusted_proxy'}:
                    raise ValueError('FRONTEND_IDENTITY_MODE_UNQUALIFIED')
                return {'source_sha256': value['source_sha256'], 'identity_mode': value.get('identity_mode')}
            observe('F', frontend_identity)
            expected_release = os.environ.get('PV1_RELEASE_CANDIDATE_SHA', '').strip().lower()
            def backend_identity():
                value = fetch_json(backend + '/api/v1/readiness?probe=' + tag)
                if not re.fullmatch('[0-9a-f]{64}', expected_release) or value.get('status') != 'ready' or value.get('production_mode') is not True or value.get('release_candidate_sha') != expected_release or value.get('backend_source_sha256') != source_fingerprint(ROOT / 'backend/app', backend=True):
                    raise ValueError('BACKEND_RELEASE_MISMATCH')
                if checks['F']['status'] == 'P' and details['F']['identity_mode'] != value.get('identity_mode'):
                    raise ValueError('FRONTEND_BACKEND_IDENTITY_MODE_MISMATCH')
                return {'source_sha256': value['backend_source_sha256'], 'release_candidate_sha': expected_release, 'production_mode': True, 'identity_mode': value.get('identity_mode')}
            observe('A', backend_identity)
        except ValueError:
            checks['F'] = checks['A'] = {'status': 'F', 'reason': 'HTTPS_ORIGIN_REQUIRED'}
    if args.attest and sys.stdin.isatty():
        print('Record completed observations only: yes / no / blank=not yet. These remain human attestations.')
        for key in ('F', 'A'):
            if checks[key]['reason'] != 'BROWSER_AUTH_REQUIRED': continue
            print(f'[{key}] Open the corresponding identity endpoint in your authenticated company browser. Enter observed public values only; blank leaves it unverified.')
            digest = input('Observed source_sha256 (backend_source_sha256 for A): ').strip().lower()
            if not digest: continue
            expected_digest = runtime_source_before['frontend' if key == 'F' else 'backend']
            matched = digest == expected_digest
            identity_mode = input('Observed identity_mode (environment/trusted_proxy): ').strip()
            matched = matched and identity_mode in {'environment', 'trusted_proxy'}
            if key == 'A':
                release = input('Observed release_candidate_sha: ').strip().lower()
                production = input('Observed production_mode is true? yes/no: ').strip().lower()
                expected_release = os.environ.get('PV1_RELEASE_CANDIDATE_SHA', '').strip().lower()
                matched = matched and bool(re.fullmatch('[0-9a-f]{64}', expected_release)) and release == expected_release and production == 'yes'
            checks[key] = {'status': 'A' if matched else 'F', 'reason': 'BROWSER_OBSERVED_IDENTITY'}
            details[key] = {'source_sha256': digest if re.fullmatch('[0-9a-f]{64}', digest) else None,
                'identity_mode': identity_mode if identity_mode in {'environment', 'trusted_proxy'} else None,
                'observed_in_authenticated_browser': True}
        if all(checks[key]['status'] in {'P', 'A'} for key in ('F', 'A')) and details['F'].get('identity_mode') != details['A'].get('identity_mode'):
            checks['F'] = {'status': 'F', 'reason': 'FRONTEND_BACKEND_IDENTITY_MODE_MISMATCH'}
        for key, prompt in MANUAL.items():
            answer = input(f'[{key}] {prompt}\n> ').strip().lower()
            checks[key] = {'status': 'A' if answer == 'yes' else 'F' if answer == 'no' else 'N' if key == 'P' and answer in {'n/a', 'na'} else 'U', 'reason': 'OPERATOR_ATTESTATION'}
        if checks['H']['status'] == 'A':
            participants = input('Number of actual engineer pilot participants (no names): ').strip()
            if not participants.isdecimal() or not 1 <= int(participants) <= 1000:
                checks['H'] = {'status': 'U', 'reason': 'PARTICIPANTS_NOT_RECORDED'}
            else: details['H'] = {'anonymous_engineer_count': int(participants)}
    try:
        post_hashes = {name: sha((ROOT / name).read_bytes()) for name in hashes}
        source_unchanged = (post_hashes == hashes and git('branch', '--show-current').strip() == b'main'
            and git('rev-parse', 'HEAD').decode().strip() == args.expected_head
            and not git('status', '--porcelain=v1', '-uall').strip()
            and runtime_source_before == {'backend': source_fingerprint(ROOT / 'backend/app', backend=True),
                'frontend': source_fingerprint(ROOT / 'frontend/src')})
    except (OSError, ValueError, subprocess.SubprocessError):
        post_hashes, source_unchanged = {}, False
    if not source_unchanged:
        checks['S'] = {'status': 'F', 'reason': 'SOURCE_CHANGED_DURING_PROBE'}
    report = {'schema_version': 1, 'at_utc': datetime.now(timezone.utc).isoformat(), 'head': args.expected_head,
        'probe_sha256': args.probe_sha, 'order': ORDER, 'checks': checks, 'details': details,
        'source_pre_sha256': hashes, 'source_post_sha256': post_hashes, 'source_patch_sha256': NO_CHANGE_PATCH_SHA256,
        'source_unchanged': source_unchanged, 'source_modified_by_probe': False, 'live_database_values_modified': False, 'external_services_called': False,
        'production_accepted': False, 'scope': 'automated diagnostics plus separately identified operator attestations'}
    code = package(output, report)
    print('Evidence retained inside the company environment. Type back only this line:')
    print(code)
    return 1 if any(check['status'] == 'F' for check in checks.values()) else 3 if any(check['status'] == 'U' for check in checks.values()) else 0


if __name__ == '__main__':
    raise SystemExit(main())
