# Conservative visual-enforcement baseline

This is the documented baseline for `golden.visual-enforcement.v1`. It enables objective checks that need no SysGrid-specific selector or layout assumption. The thresholds below are the existing candidate runner defaults, now surfaced for review; they are implementation tolerances, not a universal aesthetic score or a project contract.

## Default measurements

- Text/layout comparison tolerance: **1 CSS px**, to absorb browser subpixel rounding.
- Report a text intersection only when the overlap area is at least **4 CSS px²** and at least **12% of the smaller text fragment**.
- Image-aspect distortion tolerance, when an image is present: **0.03 in absolute log aspect-ratio difference**.
- Horizontal page overflow is **opt-in per source-bound profile** because an application may intentionally use a root-level canvas or scroll surface.

The runner still checks the entire declared rendered document for text collisions, clipping and truncation. It does not treat every intersecting box as a defect; explicit project rules can permit known overlays. Intentional clipping requires an explicit profile rule that keeps the exact text keyboard-discoverable.

## Project policy boundary

Projects declare only constraints supported by source and approved contracts. Route controls, contrast selectors/states, geometry, scroll targets, focus paths, dialogs, design tokens and transition watches need representative route-state inputs. Missing values remain unconfigured/NOT_RUN and must not be inferred from screenshots or an agent's preference. The CLI report lists unconfigured checks; requesting one of them without adequate profile/route evidence blocks the run.

## SysGrid proposal

`examples/sysgrid_visual_enforcement_profile_PROPOSED.json` applies the three generic baseline checks (`collisions`, `clipping`, and document-level horizontal overflow) to the exact source-bound 6fa… overlay. The no-root-overflow rule is consistent with the observed full-width, `min-w-0`, `overflow-hidden` application shell and the table standard's rule that horizontal scrolling belongs inside a grid when its columns overflow. It does not declare supported viewport bounds.

SysGrid's approved table standard specifies text contrast of 4.5:1, focus/non-text state-boundary contrast of 3:1, 42 CSS px minimum grid headers, 40 CSS px minimum desktop rows, 12 px body text, and 11 px medium column labels. These source-derived values and selectors were bound to a **PROPOSED** isolated test policy for the 2026-11-14 rendered matrix. The runner supports route/state-scoped geometry and rendered contracts. That matrix executed and passed its 32 named states, but it does not approve the profile or infer supported viewport bounds. The profile remains unapproved and its supported bounds remain unknown.

Source references are hash-bound in the proposed JSON. The full active source inventory matched the supplied 6fa… digest (3,758 files, zero mismatches); dotenv paths were excluded before inspection.
