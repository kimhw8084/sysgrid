# Golden UI/UX v0.2.6 candidate — executable rule additions

Status: isolated experimental candidate; not an approved revision to Golden UI/UX v0.2.5 or the separate Golden Agentic Engineering Standard.

1. **Backend route truth.** A G2 PASS requires the exact client route to agree with an operation in backend-generated OpenAPI and, for runtime qualification, a bound observed request/response. Compare method, exact path, server base path, query semantics, auth declaration and supported schema. Unknown OpenAPI constructs block; paths are not normalized.
2. **Patch reversibility.** A reviewed patch identity includes the complete changed-path set, each preimage/postimage byte digest and file permission mode. Verify exact replay and reversal in a new disposable tree; refuse to overwrite a divergent rollback target.
3. **Navigation continuity.** When a keyboard skip-link transition is in scope, preserve every user-state field named by the frozen task contract. Compare observed before/after values; missing capture is NOT_RUN and changed preserved state is FAIL.
4. **Focus indicator geometry.** Native keyboard reachability, focused-element visibility, own indicator perception, and same-state indicator bounds/clipping are separate checks. Missing geometry is UNKNOWN.
5. **Context-sensitive composition.** Distinguish routine local adjustments from consequential/uncertain layout choices. Do not force alternatives for routine work; compare two or three evidence-grounded alternatives for consequential forks. Keep aesthetic selection qualitative and product-specific.
6. **Quality-adjusted turnaround.** Default to one accountable implementation agent; run the cheapest relevant tests first, reuse only dependency-valid evidence, and avoid duplicating setup. No mandatory safety, correctness, accessibility, or evidence gate may be skipped to reduce elapsed time.

Executable references: `golden_uiux/backend_contracts.py`, `golden_uiux/patch_integrity.py`, `golden_uiux/navigation_gates.py`, `golden_uiux/accessibility_gates.py`, the G2/G3 dispatcher in `golden_uiux/gate_pipeline.py`, and applicable source-local skills under `opencode_skills/` (installed to either Codex or OpenCode by `install.py`).
