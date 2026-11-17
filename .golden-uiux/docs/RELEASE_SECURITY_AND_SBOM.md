# Release security, provenance, SBOM and updates — non-final candidate

**The included SHA-256 manifest is an integrity comparison, not an authentication mechanism.** It cannot establish who published the bundle. A corporate installer must verify the approved publisher signature or independently verified attestation before activation, using the actual company's trust roots and permission policy.

Core runtime: Python standard library. Optional browser runner: Playwright Python API plus approved Chromium binary, and Pillow only for pixel comparisons. These optional tools and browser binaries are **not vendored** and are not included in the zero-dependency core claim. See `SBOM.cdx.json`, which is an **incomplete first-party/direct-dependency candidate**, not an exhaustive supply-chain inventory. Generate and approve a full SBOM with locked versions and transitive dependencies in the actual build/release environment.

Proposed future release process: freeze canonical catalog and profile schema, review changed skill descriptions/MCP tools, build manifest+full SBOM, run installer error recovery suite, test real Codex and OpenCode, sign provenance and dependency inventory, deliver only approved version through company GitHub/intranet channel, notify user about compatible update, ask permission before installation, use a no-overwrite migration, preserve safe rollback and audit. Separate release of an app remains governed by external CI/Git protections.

**No signed release, automatic update process or secure corporate integration is shipped here.** Do not auto-upgrade existing v0.1 installation receipts; manually review the ownership defect in the previous version.
