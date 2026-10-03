# SysGrid UI and production-readiness review — 2026-09-30

SysGrid has real UI defects and unfinished UX work. This batch repairs the defects
listed below and serves the built frontend locally at `http://127.0.0.1:5173`.
Overall production acceptance remains **NOT ESTABLISHED**. The local environment
uses disposable synthetic data and development identity; it is not a company
production deployment.

## Governing scope and source identity

- Base: `main@d3860311f11bcb176e108391a35c348280a8de61`; initial working tree clean.
- Candidate: that base plus the immutable patch and per-file hashes in the evidence
  package. Changes are uncommitted. No commit, push, integration, or public deployment
  is part of this review.
- [SysGrid Production Contract](https://app.notion.com/p/3d9c564c8d048122a1fec9372065d3c6)
  declares the immediate System Management V1 profile: Home, Assets, Monitoring,
  Services, Network, Racks, Audit Logs, and Settings/Access. Other modules remain
  preview-only for normal users until separately graduated.
- The same contract requires coherent, predictable, accessible, efficient UI and
  authentic human/field acceptance. A working feature or a localhost test pass is
  insufficient to certify the product.
- [Project OS](https://app.notion.com/p/3d8c564c8d048108a11dfb2ef47ebf41),
  [POS-2 requirements](https://app.notion.com/p/3dbc564c8d0481138d1ffaefc701c7e9), and
  [the visual atlas standard](https://app.notion.com/p/3ddc564c8d0481cea7c5e834920ca19c)
  were read through the connected Notion workspace. The supplied repository Golden
  Workflow and the user's explicit local execution instruction govern this cycle.
- Notion's SysGrid page contains historical repository and atlas SHAs that differ
  from this checkout. Its `CURRENT — 64/64` atlas statement is bound to an older
  integrated source. It does not certify this dirty candidate. This review does not
  promote screenshots or set GO/Current in Notion.

## Defects repaired

| Area | Observed defect | Result |
| --- | --- | --- |
| Rack/site editors | Filled values were white on a white light-theme input; measured contrast was 1:1. | Filled controls use the foreground token; both themes are checked with actual typed values. |
| Dialog surfaces | Shared glass panels allowed the underlying page to bleed through the editor. | Dialog panels use an opaque themed panel background. |
| Grid interaction | Light-theme hover and alternating rows inherited dark AG Grid colors; FAR failure names remained white. | Alternating, hovered, and selected rows use theme tokens; FAR title foreground is semantic. |
| Research layout | Rows existed in the DOM but were clipped out of the visible grid. | The wrapper participates in the column flex layout; the test verifies visible rows against clipping ancestors. |
| Research columns | Long system names expanded their column until record titles disappeared from the desktop viewport. | System width is bounded; long names truncate with a full-name title; record titles must remain in view. |
| Projects palette | A separate public stylesheet overrode Soft Carbon with the old navy surface and input colors. | Approved dark identities inherit shared surface, foreground, border, and focus tokens. |
| Knowledge foregrounds | Light-theme headings, counts, queue entries, and badges were washed out. | Primary, secondary, status, and panel colors use semantic tokens; checks include record-card text. |
| Knowledge overview | A long action queue stretched summary cards and displaced records below the useful viewport. | Summary cards align at the top; the queue is bounded and keyboard-scrollable; the workspace owns record scrolling. |
| Knowledge record activation | Clickable record cards were divs without native keyboard activation. | Cards are buttons with an accessible name and visible focus; Enter opens the actual record. |
| Architecture | The populated light-theme canvas inherited pale dark-theme text and navy inputs; the mobile proposal form extended beyond its usable width. | The canonical host inherits theme variables; selected mode contrast and proposal reflow are corrected. Empty and populated forms are checked separately. |
| Rack empty state | Empty-state foregrounds were too faint in the light theme. | Shared empty states use surface and foreground tokens. |
| Asset detail loading | Opening an asset issued two identical linked-runbook requests. | The same query result is reused; the browser verifies one request. |
| Asset detail layout | Fixed sidebar and tab spacing squeezed laptop content and made sections hard to reach. | The sidebar stacks below content at laptop width, tabs wrap, and hardware/credential forms adapt their column count. |
| Asset add drafts | Hardware, credential, and relationship add drafts belonged to tabs and disappeared on tab switches or dialog close. | Drafts live in the parent view; close requests explicit discard; in-flight saves disable tab switching. Hardware/credential retention and discard are browser-proven. |
| Save feedback | Add/save controls could be clicked again while requests were pending. | Affected rack/site, hardware, credential, and relationship controls show pending labels and disable repeated submission. Hardware failure keeps its draft and shows one error notice. |
| Tenant status | A failed tenant-list request looked like an empty/default tenant state. | Failure is explicit, stale choices are hidden, and the list can be retried. Manage Tenant uses router navigation. |
| Rack impact language | A service count was synthesized as network-connection count × 2.4. | The UI reports recorded connections and connected systems, and explicitly says service impact is unavailable from network links alone. |
| Audit mobile actions | AG Grid automatically unpinned the action column, leaving target/payload buttons off screen. | The action column is compact; a constrained grid unpins timestamp columns first. Original mobile action/payload/pagination assertions pass. |

Cancellation now says **Keep editing** in rack/site discard prompts. Color choices
have accessible names and selection state. Missing asset IPs say **Not configured**.
The linked-runbook caption describes an asset link rather than claiming a matching
algorithm that the request did not execute.

## Rendered coverage

Chromium was driven against the real isolated backend. Desktop anchors use
1440 × 900 CSS pixels; mobile anchors use 390 × 844. Both Soft Carbon
(`nordic-frost-v1`) and Pure Clarity (`pure-clarity`) are captured, for 60 primary
route screenshots. Supplementary cases use 320/390/960-wide workspaces,
1024/1440-wide overlays, short-height layouts, and 200% text pressure.

| Routed surface | Review and remaining qualification |
| --- | --- |
| Home | Desktop/mobile summary and unavailable-observation presentation inspected. Real telemetry freshness and company truth still require integration evidence. |
| Assets | Populated grid, detail at laptop width, tabs, duplicate requests, draft cancellation/failure, import/export overlays, archive/undo inspected/tested. Inline edits and every nested workflow remain additional work. |
| Monitoring | Populated grid, hover contrast, theme independence, mobile navigation/grid access, Views/Display and detail theme tested. Real incident/telemetry actions need company scenarios. |
| Services | Populated grid, theme/detail independence, mobile access and shared overlays tested. Long text, bulk failure and role variants need full state coverage. |
| Network | Populated connections, contrast, theme independence, compact access and shared overlays tested. Large topologies and touch exploration are not qualified here. |
| Racks | Empty/populated layouts, site/rack editors, PDU hints, menus and dirty cancellation inspected/tested. A mobile first view spends substantial space on controls before elevations. |
| Audit Logs | Mobile target/payload actions, CSV download, analytics, pagination and short/text-pressure profiles tested. The narrow Actions heading still wraps awkwardly; labels/touch targets need usability refinement. |
| Settings/Access | Mobile tabs, current state, authorized actions, short/text-pressure/desktop holdouts tested in a fresh normal-user fixture. Every production role/permission transition is not covered. |
| Projects | Desktop/mobile palette and actual partial-data warning inspected. This fixture has no representative portfolio; Work/Plan/Timeline/Updates/Outcomes states need their full release gates. |
| Architecture | Empty-model form and populated host/proposal palette tested; mobile/desktop and legacy entry inspected. Full graph interaction, object/relation editors and selected states require further responsive/accessibility work. |
| Research | Populated desktop grid and title visibility fixed. At mobile width the initial view still emphasizes ID/system; the title requires horizontal exploration. |
| FAR | Populated desktop foreground/row contrast fixed. The mobile initial view shows IDs/actions with failure identity off screen. This is unfinished preview-module UX. |
| Knowledge | Primary tools, overview, queue, record text, keyboard opening, mobile search and text-pressure action reachability tested. Detail/form modal keyboard ownership remains a separate defect class. |
| External | Populated desktop/mobile registry and grid contrast inspected. Full mobile interaction and failure/destructive workflows are not qualified here. |
| Vendors | Populated desktop/mobile registry and row contrast inspected. Personnel/contracts and every detail/editor state remain outside this batch. |

Route captures establish what these states render. They do not imply that every
tab, CRUD dialog, loading/error branch, role, tooltip, or touch action was exercised.
Some wide grids intentionally scroll horizontally; document overflow is checked
separately. Geometry alone does not establish that the best information appears first.

## Validation and evidence interpretation

- Frontend unit suite: **761 passed in 148 files**; raw JSON retained.
- Typecheck, four operational contract checks, production build, and diff hygiene:
  **passed**. Later styling adjustments received fresh build/typecheck/browser proof.
- Browser evidence combines built-root route/theme/overlay/compact cases, final
  affected-workspace reruns, and a fresh normal-profile responsive gate: **38 distinct
  checks pass**. The complete built-root run had 32 passes, 5 profile skips and one
  Knowledge viewport failure; after the fix, all 14 affected cases pass, including
  that matrix. The fresh normal gate has 5 passes and 2 root-profile skips. The
  remaining 19 built-root cases are unaffected by the later Knowledge/Architecture
  adjustments. Exact counts and original failures are recorded in the package.
- The normal profile intentionally skips the two root-preview routes. Root preview
  intentionally skips five normal-profile scenarios; they are run in the normal
  profile rather than counted as passing skips.
- Architecture empty-form checks use a narrowly scoped empty-list response; the
  responsive creation journey restores the real API before creation. Populated
  Architecture palette/proposal checks create a real model through the backend.
- Failure injection is explicit: hardware POST 503 with a controlled pending request,
  and tenant-list GET 503 followed by a real retry. Other integration flows use real
  backend responses.
- Early failed runs exposed actual defects. Other stops were fixture/configuration
  errors: repeated fixed hostnames, missing required asset data, missing disposable
  database environment, previously created models/groups, and a built-preview
  origin outside the backend's configured CORS allowlist. They are retained as
  history and classified. Assertions, retries and timeout budgets were not relaxed.
- Route-ready timing samples include navigation/waits. They are neither INP nor a
  p95 performance qualification. The contrast helper handles composited solid
  colors and filled control values; gradients, ancestor opacity, icon contrast,
  assistive technology and all focus states need further evaluation.

## Work required before production acceptance

| Priority / boundary | Required work | Acceptance evidence |
| --- | --- | --- |
| P0, released tenant workflows | Guard unsaved work **before** tenant selection POST and reload. The server selection currently changes before the unload decision. | Cancelled switch leaves server/client tenant and every draft unchanged; approved switch resets context atomically; two tabs and stale permissions tested. |
| P1, released asset workflows | Protect existing hardware/credential/relationship inline edits as well as add drafts; cover all nested detail jumps and router/unload paths. Inline tables still own local edit state. | Draft retention/discard and pending/failure recovery for each edit/jump, without duplicated writes or misleading notices. |
| P1, shared interaction | Finish modal/dialog ownership for legacy preview detail/form surfaces, including KnowledgeDetails' fixed overlay. Card keyboard activation alone does not supply focus trap, Escape ownership or focus return. | Keyboard-only journeys, screen-reader review, nested selectors, focus restoration, meaningful names and no hidden active controls. |
| P1, mobile product hierarchy | Put primary record identity before secondary metadata in Research/FAR; reduce above-record chrome in Knowledge/Racks where useful; refine wrapped/truncated headings and long-name displays. | Real tasks on supported phones, landscape and short screens; reserved viewport holdout; record identity and primary action visible/reachable without guesswork. Preview modules must pass before graduation. |
| P1, data/error truth | Audit each related-data query and mutation for pending, empty, partial, stale, permission-denied, conflict and unavailable states. Knowledge and several asset context queries parse JSON without local response-state handling. | Failure matrix for primary and auxiliary API responses, clear recovery, retained drafts and no false zero/empty/success claims. |
| P1, performance | Measure actual typing, searching, scrolling, resizing, opening detail and graph navigation on realistic estates and slower supported devices. Reduce measured bottlenecks and query waterfalls. | Cold/warm timings, INP/long tasks, memory/DOM bounds and slow-network/CPU profiles, with raw samples and fixed budgets. Build still warns about 589 KB and 1,107 KB minified chunks. |
| P1, interaction state space | Complete the state/role matrix beyond these 15 routed defaults, including imports, exports, bulk partial failure, destructive previews, history/restore, saved layouts and domain editors. | Exact-candidate browser evidence, adverse data lengths, permission changes and cross-domain journeys. A screenshot count is not state-space coverage. |
| Release evidence | Refresh the affected visual atlas after approved integration; reconcile stale source references and every required surface key. | Exact integrated tree/runtime/image hashes, canonical desktop/mobile anchors, no duplicate/missing/stale active records and independent pixel review. |
| Company deployment | Qualify actual identity/proxy/CORS/host policy, secrets custody, protected CI, fresh-PC bootstrap, persistence, migration, restore and rollback. | Repository-native full checks on exact candidate plus company-environment execution/recovery proof. Local development identity is insufficient. |
| Company usability | Run authentic engineer tasks and sustained daily use in the declared supported estate; record errors, task time, recovery, accessibility and reasons users leave the app. | Human/field evidence under the product contract; authentic P14 evidence for the applicable PV1 release line. |
| PV1 graduation | Execute fresh P12, then P13, then authentic P14 on the exact stabilized lineage. | Preserve the 136/124/0/0/12 gate arithmetic, required fixtures, sample counts, budgets, and candidate/DB/evidence integrity. This UI batch is not a P12 pass. |

Real operational adapters and end-to-end maintenance/execution, privileged secret
custody, canonical cross-domain authority, and deployment recovery remain product
gates where included in the deployed scope. Their existence must be proved in
current source/runtime; historical Notion blocker prose is not assumed current
merely because it appears in a long brief.

## Verdict, lesson, next rule

**Verdict:** accept only the listed repairs against their recorded evidence after
the immutable patch replay and manifest checks succeed. Whole-product production
release and full visual-atlas currency remain unaccepted.

**Lesson:** empty form screenshots and DOM-row counts missed real white-on-white
values, hidden grid rows, hover colors and populated-host defects. Screens must be
viewed with representative values and adverse data, and geometry must identify the
visible content owner.

**Next rule:** every theme-sensitive form is checked filled; populated grids are
checked for clipping, primary identity and hover/alternating-row contrast; child
drafts are checked across tab/close/failure/pending transitions; empty and populated
preview hosts receive separate evidence. Bind the evidence to the exact patch/build
and label every unexecuted production gate explicitly.
