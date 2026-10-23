import json
import re
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "application-ci.yml"
CONTRACT_PATH = REPO_ROOT / ".github" / "required-checks.json"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def step_block(job: str, name: str) -> str:
    marker = f"      - name: {name}\n"
    start = job.index(marker)
    remainder = job[start + len(marker) :]
    next_step = remainder.find("\n      - name: ")
    return remainder if next_step == -1 else remainder[:next_step]


def main() -> None:
    workflow = read(WORKFLOW_PATH)
    contract = json.loads(read(CONTRACT_PATH))
    gitignore = read(REPO_ROOT / ".gitignore")

    assert "name: Application CI\n" in workflow
    assert "on:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n  workflow_dispatch:\n" in workflow
    assert "paths-ignore:" not in workflow
    assert "paths:" not in workflow
    assert "pull_request_target" not in workflow
    assert re.search(r"(?m)^permissions:\n  contents: read\n", workflow)
    assert "actions: write" not in workflow
    assert "contents: write" not in workflow
    assert "group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}" in workflow
    assert "cancel-in-progress: true" in workflow

    qualification_job, remaining = workflow.split("  qualification:\n", 1)[1].split("  normal_v1:\n", 1)
    normal_job, required_job = remaining.split("  required:\n", 1)
    assert "    name: qualification (${{ matrix.label }})\n" in qualification_job
    assert "      fail-fast: false\n" in qualification_job
    assert "exclude:" not in qualification_job
    assert "        include:\n" in qualification_job
    for stage in ['checks', 'desktop', 'root-preview']:
        assert f'- {{stage: {stage}, label: {stage}, artifact: {stage}, shard: ""}}' in qualification_job
    for index in range(1, 4):
        assert f'- {{stage: normal-v1, label: normal-v1 shard {index}/3, artifact: normal-v1-{index}, shard: "{index}/3"}}' in qualification_job
    assert "continue-on-error" not in workflow
    assert workflow.count("    timeout-minutes: 45\n") == 3
    assert "runs-on: ubuntu-24.04" in qualification_job
    assert "    name: required\n" in required_job
    assert "    needs: [qualification, normal_v1]\n    if: always()\n" in required_job
    assert "QUALIFICATION_RESULT: ${{ needs.qualification.result }}" in required_job
    job_env = qualification_job.split("    steps:\n", 1)[0]
    assert "runner" not in job_env
    assert "SYSGRID_VERIFY_TEMP_ROOT" not in job_env
    assert "CANDIDATE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}" in job_env
    assert "QUALIFICATION_STAGE: ${{ matrix.stage }}" in job_env
    assert "SYSGRID_VERIFY_SHARD: ${{ matrix.shard }}" in job_env
    assert "    name: qualification (normal-v1)\n" in normal_job
    assert "    needs: qualification\n    if: always()\n" in normal_job
    assert 'run: python3 scripts/verify-ci-shards.py normal-shards ci-evidence' in normal_job
    assert 'pattern: application-ci-normal-v1-*-evidence-${{ env.CANDIDATE_SHA }}' in normal_job
    assert 'name: application-ci-normal-v1-evidence-${{ env.CANDIDATE_SHA }}' in normal_job
    assert 'NORMAL_V1_RESULT: ${{ needs.normal_v1.result }}' in required_job

    decisive_steps = (
        "Check candidate whitespace",
        "Install frontend dependencies",
        "Install backend dependencies",
        "Install Playwright Chromium",
        "Run canonical application verifier",
    )
    for name in decisive_steps:
        block = step_block(qualification_job, name)
        assert "if:" not in block, name

    whitespace_step = step_block(qualification_job, "Check candidate whitespace")
    assert 'pull_request)' in whitespace_step
    assert 'base_sha="${PR_BASE_SHA:-}"' in whitespace_step
    assert 'if [[ -z "$base_sha" ]] || ! git cat-file -e "$base_sha^{commit}" 2>/dev/null;' in whitespace_step
    assert 'push)' in whitespace_step
    assert 'event_before="${EVENT_BEFORE:-}"' in whitespace_step
    assert '[[ -n "$event_before" && ! "$event_before" =~ ^0+$' in whitespace_step
    assert '"$event_before" != "$GITHUB_SHA"' in whitespace_step
    assert 'git cat-file -e "$event_before^{commit}" 2>/dev/null' in whitespace_step
    assert 'workflow_dispatch)' in whitespace_step
    assert 'if [[ "$GITHUB_REF_NAME" == "main" ]]' in whitespace_step
    assert 'base_sha="$(git rev-parse "$GITHUB_SHA^" 2>/dev/null || true)"' in whitespace_step
    assert 'git show-ref --verify --quiet refs/remotes/origin/main' in whitespace_step
    assert 'git merge-base "$GITHUB_SHA" origin/main' in whitespace_step
    assert 'if [[ -z "$base_sha" ]]; then' in whitespace_step
    assert 'if git rev-parse "$GITHUB_SHA^" >/dev/null 2>&1; then' in whitespace_step
    empty_tree_fallback = 'base_sha="4b825dc642cb6eb9a060e54bf8d69288fbee4904"'
    assert empty_tree_fallback in whitespace_step
    assert whitespace_step.index(empty_tree_fallback) > whitespace_step.index('if git rev-parse "$GITHUB_SHA^" >/dev/null 2>&1; then')
    assert 'echo "SYSGRID_CANDIDATE_BASE_SHA=$base_sha" >> "$GITHUB_ENV"' in whitespace_step
    assert 'git diff --check "$base_sha..$GITHUB_SHA"' in whitespace_step
    assert 'git diff --check 4b825dc642cb6eb9a060e54bf8d69288fbee4904' not in whitespace_step
    assert "npm ci --prefix frontend" in qualification_job
    assert "frontend/package-lock.json" in qualification_job
    assert "--require-hashes" in qualification_job
    assert "-r backend/requirements.lock" in qualification_job
    assert '"$GITHUB_WORKSPACE/scripts/verify-app.sh" --stage "$QUALIFICATION_STAGE"' in qualification_job
    verifier_step = step_block(qualification_job, "Run canonical application verifier")
    assert 'SYSGRID_VERIFY_TEMP_ROOT="$RUNNER_TEMP/sysgrid-verification"' in verifier_step
    assert "SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID: ci-system-root" in workflow
    assert "SYSGRID_VERIFY_USER_ID" not in workflow
    assert "SYSGRID_VERIFY_PROFILE=root-preview" not in workflow
    assert "scripts/verify-app.sh" in qualification_job
    for divergent_command in (
        "pytest",
        "npm run check:operational-contracts",
        "npm run typecheck",
        "npm run test:coverage",
        "npm run build",
    ):
        assert divergent_command not in workflow, divergent_command

    assert "if: always()" in qualification_job
    assert "ci-evidence/ci-identity.json" in qualification_job
    assert "qualification_stage" in qualification_job
    assert "qualification_result" in qualification_job
    assert "final_required_gate_result" not in qualification_job
    evidence_step = step_block(qualification_job, "Collect SHA-bound CI evidence")
    assert '"github_sha": os.environ["GITHUB_SHA"]' in evidence_step
    assert '"tested_trigger_sha": os.environ["GITHUB_SHA"]' in evidence_step
    assert '"candidate_sha": os.environ["CANDIDATE_SHA"]' in evidence_step
    assert "pr_base_sha" in evidence_step
    assert '"candidate_base_sha": os.environ.get("SYSGRID_CANDIDATE_BASE_SHA") or None' in evidence_step
    assert '"pr_base_sha": os.environ.get("PR_BASE_SHA") or None' in evidence_step
    assert '"BASE_SHA"' not in evidence_step
    assert "backend/test-results" in qualification_job
    assert "frontend/test-results" in qualification_job
    assert "frontend/test-results-v1" in qualification_job
    assert "frontend/test-results-desktop" in qualification_job
    assert "frontend/test-results-root-preview" in qualification_job
    assert "frontend/playwright-report-desktop" in qualification_job
    assert "owned-runtime" in qualification_job
    assert "application-ci-${{ matrix.artifact }}-evidence-${{ env.CANDIDATE_SHA }}" in qualification_job
    assert '"qualification_shard": os.environ.get("SYSGRID_VERIFY_SHARD") or None' in evidence_step

    barrier = step_block(required_job, "Require every qualification stage")
    assert "if:" not in barrier
    assert 'if [[ "$QUALIFICATION_RESULT" != success || "$NORMAL_V1_RESULT" != success ]]; then' in barrier and 'exit 1' in barrier
    aggregate = step_block(required_job, "Collect aggregate CI identity")
    assert '"schema_version": "sysgrid.application-ci.evidence.v2"' in aggregate
    assert '"tested_trigger_sha": os.environ["GITHUB_SHA"]' in aggregate
    assert '"candidate_sha": os.environ["CANDIDATE_SHA"]' in aggregate
    assert '"qualification_stages": ["checks", "normal-v1", "desktop", "root-preview"]' in aggregate
    assert '"ref": os.environ["GITHUB_REF"]' in aggregate
    assert '"head_ref": os.environ.get("GITHUB_HEAD_REF") or os.environ["GITHUB_REF_NAME"]' in aggregate
    assert '"stage_evidence_artifacts"' in aggregate and '"runtime_provenance"' in aggregate
    assert '"final_required_gate_result": os.environ["FINAL_REQUIRED_GATE_RESULT"]' in aggregate
    assert "application-ci-evidence-${{ env.CANDIDATE_SHA }}" in required_job
    assert "actions/upload-artifact@" in required_job
    assert all(
        re.search(rf"uses: {re.escape(action)}@[0-9a-f]{{40}}", workflow)
        for action in (
            "actions/checkout",
            "actions/setup-node",
            "actions/setup-python",
            "actions/upload-artifact",
            "actions/download-artifact",
        )
    )

    assert contract == {
        "schema_version": "sysgrid.required-checks.v1",
        "target_branch": "main",
        "required_check": "Application CI / required",
        "workflow": ".github/workflows/application-ci.yml",
        "protection_required": True,
    }
    assert contract["workflow"] == WORKFLOW_PATH.relative_to(REPO_ROOT).as_posix()
    assert "Application CI / required" not in read(REPO_ROOT / ".github" / "workflows" / "ai-review-packet.yml")
    assert "Application CI / required" not in read(REPO_ROOT / ".github" / "workflows" / "sysgrid-public-outbox-relay.yml")

    check_ignore = subprocess.run(
        ["git", "check-ignore", "--no-index", "-q", "ci-evidence/ci-identity.json"],
        cwd=REPO_ROOT,
        check=False,
    )
    assert check_ignore.returncode == 0
    assert "ci-evidence/" in gitignore

    staged_files = subprocess.run(
        ["git", "ls-files", "--stage"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert not any(line.startswith("160000 ") for line in staged_files)
    assert not (REPO_ROOT / ".gitmodules").exists()
    print("application CI contract: PASS")


if __name__ == "__main__":
    main()
