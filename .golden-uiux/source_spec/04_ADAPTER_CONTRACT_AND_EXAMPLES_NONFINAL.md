# Project Adapter Authority and Examples — NON-FINAL

A universal UI law governs behavior; the adapter supplies approved project-specific implementation choices. An agent MUST NOT manufacture company approval or brand identity from sample values.

## Required envelope

`project_id`, `profile_id`, `profile_version`, `approval_status`, `reviewer_identity/reference`, `profile_digest`, `source_revision`, `component_registry` (semantic role -> existing component path), `token_profile` (typed references and schema version), `density_modes` (requested/effective with preservation), `breakpoint_policy` (content-derived fallbacks), `interaction_profile` (native controls, keyboard, overlays and forms), `accessibility_policy` (required standard and exceptions), `user_preferences` (persistence/precedence), `geometry_baselines` (viewport/state/zoom/device/exceptions), `quality_gate_map`, `open_questions`, `expiry/compatibility`, `offline_snapshot` and `rollback_ref`. Missing approval status remains UNKNOWN; project adapter cannot grant code execution.

## Resolver precedence

1. Existing authorized native component matched by semantics, with correct role/keyboard contracts.
2. Approved design-system variant, when native component doesn't fit.
3. Approved local starter profile only for explicitly greenfield projects.
4. Unresolved component choice -> request a narrow design decision. No universal color, font, row-size or layout value may override the approved project.

## Example A: existing compact operations application (illustrative, not an authorized SysGrid change)

Intent: find and edit a record. User wants compact rows and saved panels. Choose approved operational grid, existing command bar, detail inspector, and dirty guard. Retain project-specific B2.1 colors and eligible 11px/24px settings *only when that project has authorized them*; do not enlarge unchanged controls. Verify paired geometry at identical viewport, font, zoom and state. No global style migration.

## Example B: hypothetical customer support portal (NOT a verified company-approved profile)

Intent: browse support cases and edit case details. Prefer an ordinary semantic table for read-only comparison and case-detail form. Use the fictional approved starter's own tokens, typography and responsive behavior only *if* the company later approves it. Do not copy operations-grid sizing. Test role denial, save conflict, reload, keyboard and mobile states. If no approved starter profile is available, pause brand-dependent design rather than inventing one.

## Conflict protocol

If project adapter and universal behavior disagree on keyboard or accessibility, preserve mandatory safety and escalate only the invalid variant. If adapter/provenance is stale or cannot be verified offline, continue unaffected tasks with an approved compatible snapshot; do not silently downgrade. For a user-requested small font, retain the stored request and independently compute any safe effective presentation according to project-specific policy; no forced universal 11px/24px.

## Ownership

Project adapter owner approves tokens, component bindings, breakpoints and authorized exceptions; standard maintainer approves universal pattern changes; independent reviewers qualify exact outputs. Neither an MCP nor an LLM may approve its own changes.

## Integrated canonical conflict rule

For precedence use P0-01 exactly; for necessary accessible geometry accommodations use P1-04 exactly. The project adapter never overrides mandatory law, security, accessibility, privacy or data integrity; a missing review/approval is UNKNOWN, not approved. A project-specific permitted exception must be time-bound, scoped and independently reviewed where required. All examples remain hypothetical / project-specific.
