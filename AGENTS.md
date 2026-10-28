# SysGrid Collaboration Workflow

## Direct implementation

Codex may inspect and edit the shared working tree directly, then run deterministic validation and browser checks needed for the requested work. Do not require an immutable-patch handoff or a user-terminal execution cycle for ordinary repository changes.

Keep changes scoped to the user's request. Preserve all pre-existing local changes, inspect the relevant diff before editing, and never use `git reset`, `git clean`, or overwrite unrelated work.

## Terminal safety

Terminal commands must never invoke or delegate code generation to:

- Codex, OpenCode, ChatGPT, or another coding agent;
- an LLM API or model CLI;
- a generated prompt, autonomous agent loop, dynamic patch author, or equivalent wrapper.

Use terminal tools only for deterministic repository operations, builds, checks, and evidence collection. Do not auto-fix failed validation, weaken tests, or change retry and timeout settings to hide failures. Report failures with their evidence.

## Version control

Do not commit or push unless the user has explicitly authorized that action. Do not include unrelated pre-existing changes in a commit. Never rewrite shared history.
