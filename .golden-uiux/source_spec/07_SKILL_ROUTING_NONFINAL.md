# Native OpenCode Skill Routing — NON-FINAL

**This ZIP deliberately stores candidate `SKILL.md` files under `candidate_skills/`, NOT `.opencode/skills/` or a global discovery path. It does not activate anything.**

Current OpenCode skills use YAML frontmatter `name` and `description` and can be discovered on demand; exact compatibility and current installed version require future inspection. Source: https://opencode.ai/docs/skills

**Routing principle:** permanent entrypoint contains only work authority + routing instructions; never inject all skill bodies. Select patterns from a structured, evidence-backed intent specification: user outcome, ordered workflow, component needs, constraints and applicable states. Keyword matches may suggest questions or diagnostics, but cannot select patterns by themselves. Add all applicable pattern and skill coverage required by the task; do not impose a fixed skill-count cap. The catalog is canonical; skills direct retrieval rather than repeating normative claims. Context policy must explicitly enforce limits and expiry of pinned local snapshots. Local packet assembly is not proof that a live client discovered, loaded or followed a skill; that claim remains UNKNOWN until client-observed evidence is available.

| Candidate skill | Purpose |
|---|---|
| `ui-intent-router` | Classify UI feature requests, select relevant universal pattern IDs, and detect missing authority. |
| `ui-pattern-resolution` | Choose semantic interaction patterns and existing approved components for an authorized task. |
| `ui-design-adapter` | Read approved project design profiles and preserve existing visual identity and preferences. |
| `ui-form-interactions` | Design accessible forms, dialogs, editing and actions, including failures and drafts. |
| `ui-data-and-status` | Specify semantically sound records, dashboards, monitoring status, and empty/error representations. |
| `ui-responsive-geometry` | Preserve approved density while designing for viewport, zoom and content adaptation. |
| `ui-accessibility-contract` | Define and inspect accessible keyboard semantics and applicable WCAG 2.2 obligations. |
| `ui-content-localization` | Specify accurate interface copy, localization and actionable feedback under stress. |
| `ui-evidence-gate` | Build a reviewable evidence plan without inventing test results or permission. |

**Interference prevention:** no automatic model/provider setting changes, no modification of existing `AGENTS.md` or project `.opencode`, no production tool calls. No skill file grants permissions.

## P1-01 cross-cutting coverage (canonical)

**Pattern selection and mandatory coverage**

The resolver SHOULD identify one to three primary UI intent families to minimize unnecessary model context.

This is a context-loading optimization, NOT a limit on the number of applicable requirements.

All mandatory cross-cutting requirements, including applicable accessibility, responsive behavior, security, permissions, state preservation, and quality-evidence obligations, remain in force regardless of the number of pattern files loaded.

Additional pattern contracts MUST be loaded whenever their requirements materially affect the task or a detected dependency makes them necessary.

The resolver MUST record the applicable pattern identifiers and coverage obligations. It MUST NOT omit a mandatory contract solely to satisfy a token budget or tool-call target.

Identical approved inputs and versions SHOULD yield equivalent pattern selections and requirements. Differences MUST be traceable to documented project context, policy, or unresolved ambiguity.
