# v0.2.6 experimental executable improvements

This candidate is a source-bounded evolution of the manifest-verified v0.2.5 experimental pilot. It does not change v0.2.5, the separate Golden Agentic Engineering Standard, the v0.2.4 baseline, SysGrid, or constitutional governance.

## G2 — backend-derived API semantics

The G2 dispatcher requires a backend-generated OpenAPI 3 document in its hash-addressed input. It resolves the exact backend operation, including server URL/base path, method, path template, required/query parameter names and types, authentication declaration, expected status codes, and supported request/response schema fields. Trailing slash normalization is never applied. A missing or unsupported OpenAPI construct returns BLOCKED; an exact missing/mismatched route returns FAIL. The G2 runtime result also requires the observed request/response and bound identity. When OpenAPI does not carry an identity-scope extension, the result says identity scope remains separately bound; it does not infer tenant enforcement from bearer authentication.

Quick route check: `python3 uiux.py api-contract request.json`. Request fields: `contract`, `client_route`, `openapi_document`, optional `observed` and `expected_identity`. Without observed request evidence, the command reports NOT_RUN for the runtime subcheck and returns nonzero.

## Complete patch identity and exact reversal

`patch-manifest` inventories the complete source-tree diff by relative path, exact bytes SHA-256 and permission mode, including additions and deletions. It refuses symlinks, special files, incomplete manifests and unsafe paths. `patch-replay` copies the frozen source to a new scratch directory, verifies exact preimages, applies candidate postimages only in the scratch copy, verifies the complete candidate tree, reverses only while all postimages still match, and proves the full original file tree is restored. If an intervening scratch edit appears, reverse refuses to overwrite it. Neither command writes to the baseline or candidate roots, and neither authorizes real project integration.

## G3/G5 — continuity, visible focus, element clipping

The G3 focus evaluator requires same-state bounds for the actual focused element's own visible indicator and evaluates that indicator against the viewport and clipping ancestors. Missing bounds remain UNKNOWN. The skip-link check now requires a native-keyboard state-capture record comparing explicitly selected route/context fields; missing state is NOT_RUN and changed preserved state is FAIL. `navigation-continuity` is the direct diagnostic; the same record belongs in G3 `skip_link` for dispatch. Artifact binding is checked by the `evaluate-gates` outer dispatcher.

## Design choice and engineering effort

The source-bound design-session task asks the agent to inspect actual user intent and current project conventions, then mark the layout decision ROUTINE or CONSEQUENTIAL with rationale. Routine local changes use one direction. Consequential or materially uncertain composition choices compare two or three distinct feasible options against six qualitative criteria. Product-specific visual decisions remain product-specific, and no universal numeric aesthetic score is introduced. The task uses one accountable implementation agent by default, runs cheap relevant checks first, reuses evidence only when dependencies match, and preserves all mandatory gates.

## Proof scope and limits

The new tests exercise offline synthetic OpenAPI, patch, navigation and focus-geometry inputs. They prove the validators' behavior on those fixtures only. They do not prove an actual backend generated a particular document, a browser captured the supplied measurements, a native Codex/OpenCode client loaded these skills, G1-G5 application UI qualification, visual excellence, or G6. G6 remains UNKNOWN; rendered-browser qualification is NOT_RUN.
