# Separate Codex and OpenCode validation (candidate; must run at destination)

## Shared canonical rules

One `data/patterns.json` and one `source_spec/02_14_COMPLETE_PATTERN_CONTRACTS_NONFINAL.md` generated from it. Nine `SKILL.md` files are stored under `opencode_skills/` in this package. Installer selects only the client destination; copied skill bytes are identical.

## Codex

- Documented repository skills location: `.agents/skills/<skill-id>/SKILL.md`.
- Prefer `python3 install.py --target ... --client shared` if both Codex and installed OpenCode recognize this path, or `--client codex` for Codex-only.
- After approved installation, use actual Codex to list/load `ui-intent-router`; test a positive trigger such as “Design a keyboard-safe editable table and save flow” and a negative trigger such as “Explain a pure backend SQL migration”, confirming the UI skill is not loaded for unrelated work.
- Compare reported catalog SHA with `python3 .golden-uiux/uiux.py digest`; inspect output for clear proposed/NOT_RUN statuses. No package file can confer source modification authority.

## OpenCode

- Documented project-local skill locations: `.opencode/skills/<skill-id>/SKILL.md`, with `.agents/skills/` compatibility supported in current V2 and relevant V1 docs. Actual local version/precedence matters.
- Use `--client opencode` when needed; avoid double-install duplicate skill IDs. Query `opencode mcp list` only after reviewed registration, and verify `initialize`, `tools/list`, `uiux_get_pattern(P04)` and `uiux_feature_intake` through the actual client.
- V1 sample MCP config differs from V2. Current V2 uses `mcp.servers.<name>`; older uses `mcp.<name>`. Build from `install.py --mcp-snippet v1|v2`, and manually reconcile corporate settings. Never overwrite provider/model/permission controls.
- Run offline with network disconnected using installed approved snapshot; inspect stderr/stdout hygiene and tool inventory (read-only annotations are hints, not security authority).

## Required client compatibility evidence

Capture actual client binary/version, platform, skill list and chosen skill name, active MCP discovery/tool results, exact pattern digest, package manifest hash, policy/credential constraints, online/offline outcome, any tool-name collision, and independent reviewer. A mock stdio test is not a client test.

## Sources

- Codex skills: https://learn.chatgpt.com/docs/build-skills?product=breeze
- OpenCode V2 skills: https://dev.opencode.ai/v2/docs/skills/
- OpenCode V2 MCP: https://opencode.ai/v2/docs/mcp-servers

## Browser runtime gate before application qualification

A green portable `python3 -m unittest discover -s tests` may have explicit browser-fixture SKIPs; read the test summary. Require a separate successful `python3 devtools/browser_capability_gate.py --output /tmp/golden-uiux-browser-runtime` **on each supported client/runtime** before treating browser capability as available. This gate is only a controlled local fixture and **does not certify application browser behavior**. Missing Chromium, incompatible Playwright, or missing early WebSocket interception must prevent progress to required real-app browser qualification. Record versions, capability state, skip count, evidence location and independent reviewer in the handoff.
