# SysGrid Golden Workflow Ground Rule

This repository uses a hard separation between **patch authorship** and **terminal execution**.

## Binding workflow

```text
ChatGPT control room
  → inspects source/evidence
  → authors every source change and immutable patch
  → mechanically verifies patch hashes, apply checks, scope, and runner safety

User terminal
  → verifies exact repository head, dirty-path set, and target-file hashes
  → applies only the embedded approved patch
  → runs migrations, tests, typecheck, build, and browser proof
  → collects evidence and creates one UPLOAD_THIS_TO_CHATGPT.zip

ChatGPT control room
  → reviews the ZIP, records verdict/lesson/next rule, and decides acceptance
```

## Terminal prohibitions

A SysGrid terminal handoff must never invoke or delegate code generation to:

- Codex, OpenCode, ChatGPT, or another coding agent;
- an LLM API or model CLI;
- a generated prompt, autonomous agent loop, or dynamic patch author;
- any equivalent alias or wrapper.

The terminal is a deterministic **verify → apply → test → evidence → package** executor only.

It must also never improvise edits, auto-fix failures, commit, push, reset, clean, weaken tests, increase retries/timeouts to hide failures, or modify files outside the approved patch.

## Required controls

Every user-facing SysGrid command must:

1. contain the exact immutable patch payload and its SHA-256;
2. verify the expected branch, head, dirty paths, and pre-patch file hashes;
3. stop before mutation on any mismatch;
4. pass `git apply --check` before applying;
5. verify exact post-patch hashes and changed-file scope;
6. pass a forbidden-command scan proving there is no terminal-side AI/agent execution;
7. run only deterministic validation and evidence collection;
8. create exactly one `UPLOAD_THIS_TO_CHATGPT.zip` with a verified manifest;
9. perform no commit or push before ChatGPT review.

This ground rule overrides any older SysGrid text that describes an AI CLI as the terminal-side coding worker. The user may override it only with an explicit instruction that clearly authorizes terminal-side code generation for that specific cycle.
