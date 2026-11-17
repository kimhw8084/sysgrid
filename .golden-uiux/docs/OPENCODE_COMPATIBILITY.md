# OpenCode MCP and skills compatibility — candidate integration guide

Supported sources checked 2026-11-02:
- V1 MCP: https://dev.opencode.ai/docs/mcp-servers/ — `mcp.<server-name>` entries, older builds use `enabled`.
- V2 MCP: https://dev.opencode.ai/v2/docs/mcp-servers/ — `mcp.servers.<server-name>` entries, use `disabled` rather than `enabled`.
- V1 and V2 native skills: https://opencode.ai/docs/skills and https://dev.opencode.ai/v2/docs/skills/ — project-local `.opencode/skills/<id>/SKILL.md` supported; check effective ID precedence, installed release and permissions.
- stdio JSON-RPC: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx — newline-delimited JSON messages, never arbitrary stdout logging.

The runtime deliberately implements the **legacy 2025-06-18 MCP session protocol** to serve clients that support it. Newer MCP 2026-07-28 differs. Don't assume compatibility across every OpenCode version; local Codex must test real initialization, tool listing and calls with its installed OpenCode. The executable exposes only seven read-only tools and two read-only resources.

After safe installer copying and checking the project's actual OpenCode version:

```bash
python3 install.py --target "/absolute/path/to/project" --mcp-snippet v1
python3 install.py --target "/absolute/path/to/project" --mcp-snippet v2
```

These are **snippets**, not complete or auto-edited config files. Make a reviewed addition to existing project/company configuration. Preserve `AGENTS.md`, model/provider settings, permissions, existing MCPs, existing global skills, and corporate policy. An unapproved tool name or config overwrite is not an acceptable shortcut.

When the MCP host is offline, direct `uiux.py` CLI can read the same pinned catalog without network access. That does **not** constitute organizational approval of the chosen design.

## Detecting a real integration

1. Inspect actual installed OpenCode binary/version and active config precedence in local environment.
2. Ensure nine skill IDs are visible and load with correct descriptions, without overriding existing skill IDs.
3. Add a single read-only MCP from the approved project config using a verified Python executable and script path.
4. Verify `initialize`, tool inventory, `uiux_get_pattern(P04)`, and `uiux_route_task` in the real OpenCode host.
5. Confirm no write-capable tools appear under this MCP, no stdout noise, no unintended network access, no new model/provider or Git settings.
6. On failure restore original config and do not claim the MCP is live.

No bundled installer sends telemetry, checks the Internet for updates, or connects to company systems. Future update checks/approval submissions belong to your separately governed platform integrations.
