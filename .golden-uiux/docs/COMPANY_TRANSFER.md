# Offline/intranet company transfer handoff

The portable core requires Python 3.10+ standard library, no npm/pip dependencies, no live network and no company tokens. Review and transfer the ZIP according to the organization's approved artifact-transfer process. `PACKAGE_SHA256.json` checks transit corruption, **not cryptographic provenance of the publisher**; use your independently approved release/signing/integrity service for provenance.

1. Verify package provenance and SHA manifest **before extraction/installation**. Examine source and tool definitions for disallowed network or write behavior. Quarantine the bundle if provenance cannot be established.
2. Run `python3 install.py --verify-only` and `python3 -m unittest discover -s tests -v` in an approved isolated environment.
3. Inventory native OpenCode version, existing Golden Engineering Standard and `.opencode/skills` paths. Preview installation with `python3 install.py --target <project>`. Conflict means **stop and reconcile** rather than overwriting.
4. After separate company approval, run `--apply`; it only creates namespaced files. MCP config is not changed. Use manual V1/V2 snippet and the corporate MCP tool registry when authorized.
5. Bind real project-specific adapters with approved owner and source revision. The example profile's `PROPOSED` status cannot qualify a design. The MCP service always returns `externally_verified_approval=false` because that decision is not its authority.
6. Integrate with existing company platform feedback/approval MCP **separately**, in its own credentials/tool namespace. Do not add write tools to this design MCP without a separately authorized architecture revision.
7. For source changes, the already separate Golden Engineering Standard and trusted grants govern OpenCode native edits, tests, commit and Git promotion. Protected main must use allowed checks/reviews/PR/auto-merge; never bypass GitHub rules.
8. Monitor local test outcomes, source-bound UX baseline, human rework, defect escapes, tool/model calls, and total TAT. A cross-team rollout requires real independent proof, not this package alone.

## Existing structure preservation

Nothing in this package touches GitHub, SysGrid Constitution v0.2.1, the separate Golden Engineering Standard, global OpenCode settings, or company MCP/approval-platform configurations. SysGrid's 44 rule IDs remain NOT_RUN in the current specification and Round 36 CONTINUE_PROVISIONAL is preserved. Any future changes require independent authorization and real proof.
