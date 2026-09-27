# CHG-52 R1 lifecycle consistency VERIFY

- Request: sysgrid-lifecycle-consistency-audit-verify-v1
- Repository: kimhw8084/sysgrid; operation VERIFY; zero Product mutation
- Exact base: main f31fd16711f0234aa058be854c2639afd2f02c4d
- Base tree: 66b1e4022ed8f44c94b0daab8278fe7be49e2025
- Result: BUILD_REQUIRED

## Findings

Current main already has authoritative controls worth retaining: PV1 Projects revision-bound owner-authorized archive/restore events; FAR expected-version, row-locked archive/restore and history; Services truthful unsupported purge.

Confirmed gaps:
1. Device blocker-only purge returns HTTP 200/status success with can_execute=false. Device lifecycle has no AuditLog; preview omits its manual dependency effects.
2. A repeated single Logical Service DELETE appends a second audit row.
3. Monitoring dry_run=true still purges; purge cascades History/Owner without AuditLog; restore_purged accepts caller-edited snapshots. UI interprets a validation 400 as capability and exposes client-snapshot Revert.
4. Maintenance DELETE does not await db.delete, returns success while the row persists, and audits DELETE anyway. No archive/restore schema exists. Route checks production assets policy, while R1 classifies Maintenance as unreleased/root-preview.
5. Architecture object retirement leaves an active relation to its retired endpoint in projection; omitted revisions are accepted. Restore remains truthfully unsupported and is not a proposed BUILD.

See the JSON matrix, classification and slices for per-cell evidence/confidence, tests, migrations, invariants and non-goals.

## Controls

PV1 and FAR are positive controls. Services purge is truthfully unsupported. Audit API is GET-only and target-filtered; no arbitrary lifecycle audit delete route found. ORM/database immutable enforcement is not present, so only API-surface append-only behavior is established.

Focused existing tests: 20 passed, 1 warning using requirements.lock in external disposable venv. Four disposable probe groups passed with one expected Maintenance warning. Preview probes used explicit synthetic System Root identity and explicit capabilities. No Product/source/test/docs/migration/config/lockfile edits, commit, PR, Notion write, deployment or persistent tenant mutation.

backend/conftest.py assigns admin_root as System Root and broad capabilities. This harness defect was not changed; probes used a distinct synthetic identity.

## Evidence carrier

Package is bound to the exact base commit/tree and is published to refs/heads/project-os-artifacts/sysgrid/sysgrid-lifecycle-consistency-audit-verify-v1, pending remote readback.

The requested native Fabric evidence ref is Fabric-owned. No native publisher tool was exposed; the ref was verified unclaimed and left untouched. This verifier does not hand-author native audit.json.

Conclusion: BUILD_REQUIRED. CHG-52 remains the Wave-A prerequisite; exact mapping from proposed slices to CHG-44/45/46/47 is not present in this binding.
