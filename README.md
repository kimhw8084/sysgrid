# CHG-50 R2 targeted evidence

Candidate: 5f29e9a7de97c6bb242666d50fdbc4c1b3ab40cb (tree 66b1e4022ed8f44c94b0daab8278fe7be49e2025)  
Parent: 876f84cf33abd441fca34195f4fdbcb8dec5e281  
Base: 899b47f9e1569f56455a0dfd8d3ffc440f4d8613 (tree 15332211fe6c39f5f3926ebc970a3c0ece362d83)  
Work branch: codex/sysgrid-project-v2-work-task-integrity-fix-v3

This artifact contains 17 state-coincident JSON/PNG pairs from the final candidate. Each JSON names the candidate SHA and proof ID, route/project/task identity, viewport/DPR, selection and draft state, scroll/focus/pending state, required-action inventory, contrast checks, and negative-control result when used. The paired-capture metadata confirms the JSON and PNG share a settled state and no browser action occurred between the state snapshot and screenshot.

The evidence covers Board open/close/Escape focus restoration; List open/close/double-click focus restoration; the exact Focus deep link and its close fallback; Board transition and bulk rejection with server truth and retained selection; List bulk rejection; failed create draft retention; delayed create and bulk acknowledgments preserving newer intent; and desktop 1440x900, mobile 390x844, and short-height 390x560 panel states. Each responsive proof includes an intentionally clipped control rejected as outside the viewport.

All proof PNGs are synthetic fixture data under explicit Root Preview policy. The mock profile uses is_admin=false; no company credentials, tenant records, or live data are included.

See manifest.json for file hashes and per-proof state, and verification.json for candidate qualification results and separately classified legacy readability failures.
