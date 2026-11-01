# SysGrid Development Workflow

- Work directly in this repository to complete the requested implementation. Do not replace code changes with a patch runner or evidence ZIP handoff unless the user asks for that workflow.
- Inspect the running application when visual behavior matters. Run the relevant tests, typecheck, build, and browser checks before reporting completion.
- Preserve unrelated user changes and artifacts. Stage only the files changed for the current task; never stage the entire worktree for a task commit.
- The user has asked for completed changes to be pushed to main. After implementation and validation, commit only the task files and push to main unless the user changes that standing instruction.
- If a repository or service restriction prevents a requested action, finish all independent work and report the specific blocker and its source.
