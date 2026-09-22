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

    required_job = workflow.split("  required:\n", 1)[1]
    assert "    name: required\n" in required_job
    assert "runs-on: ubuntu-24.04" in required_job
    assert "continue-on-error" not in required_job
    job_env = required_job.split("    steps:\n", 1)[0]
    assert "runner" not in job_env
    assert "SYSGRID_VERIFY_TEMP_ROOT" not in job_env
    assert "CANDIDATE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}" in job_env

    decisive_steps = (
        "Check candidate whitespace",
        "Install frontend dependencies",
        "Install backend dependencies",
        "Install Playwright Chromium",
        "Run canonical application verifier",
    )
    for name in decisive_steps:
        block = step_block(required_job, name)
        assert "if:" not in block, name

    assert "git diff --check" in required_job
    assert "4b825dc642cb6eb9a060e54bf8d69288fbee4904" in required_job
    assert "npm ci --prefix frontend" in required_job
    assert "frontend/package-lock.json" in required_job
    assert "--require-hashes" in required_job
    assert "-r backend/requirements.lock" in required_job
    assert '"$GITHUB_WORKSPACE/scripts/verify-app.sh"' in required_job
    verifier_step = step_block(required_job, "Run canonical application verifier")
    assert 'SYSGRID_VERIFY_TEMP_ROOT="$RUNNER_TEMP/sysgrid-verification"' in verifier_step
    assert "SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID: ci-system-root" in workflow
    assert "SYSGRID_VERIFY_USER_ID" not in workflow
    assert "SYSGRID_VERIFY_PROFILE=root-preview" not in workflow
    assert "scripts/verify-app.sh" in required_job
    for divergent_command in (
        "pytest",
        "npm run check:operational-contracts",
        "npm run typecheck",
        "npm run test:coverage",
        "npm run build",
    ):
        assert divergent_command not in workflow, divergent_command

    assert "if: always()" in required_job
    assert "ci-evidence/ci-identity.json" in required_job
    assert "final_required_gate_result" in required_job
    evidence_step = step_block(required_job, "Collect SHA-bound CI evidence")
    assert '"github_sha": os.environ["GITHUB_SHA"]' in evidence_step
    assert '"tested_trigger_sha": os.environ["GITHUB_SHA"]' in evidence_step
    assert '"candidate_sha": os.environ["CANDIDATE_SHA"]' in evidence_step
    assert "pr_base_sha" in evidence_step
    assert "backend/test-results" in required_job
    assert "frontend/test-results" in required_job
    assert "frontend/test-results-v1" in required_job
    assert "frontend/test-results-root-preview" in required_job
    assert "owned-runtime" in required_job
    assert "application-ci-evidence-${{ env.CANDIDATE_SHA }}" in required_job
    assert "actions/upload-artifact@" in required_job
    assert all(
        re.search(rf"uses: {re.escape(action)}@[0-9a-f]{{40}}", workflow)
        for action in (
            "actions/checkout",
            "actions/setup-node",
            "actions/setup-python",
            "actions/upload-artifact",
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
    print("application CI contract: PASS")


if __name__ == "__main__":
    main()
