# Golden Universal UI/UX — Fourteen Pattern Contracts

**GENERATED DOCUMENT — DO NOT EDIT DIRECTLY.** Source of truth: `data/patterns.json`. Regenerate using `python3 devtools/render_patterns.py`. All 14 remain non-final candidates and NOT_RUN.

These pattern IDs are not changes to SysGrid Constitution v0.2.1. Project-approved profiles govern visual tokens, components, density and user preferences.

## P01 — Page shell & navigation

**Intent:** Give users stable orientation and access to authorized destinations while preserving route continuity.

### MUST choose / contextual decision rules

- Existing application: retain its primary navigation and semantic landmark structure.
- Choose breadcrumbs for true hierarchy, tabs for sibling views of one context, and ordinary links for destinations.
- Place the primary content in a single discernible main region; use approved project navigation components.
- Use the approved application shell, navigation regions, page gutters, content grid, headings and scroll ownership; do not introduce a second shell.

### MUST NOT / anti-patterns

- Do not invent a global sidebar for a one-page task.
- Do not replace a known route hierarchy to achieve aesthetic consistency.
- Do not use tabs to hide independent, deep-linkable product destinations without documented approval.

### States to consider where applicable

- Initial/default route
- Deep link to a nested route
- Browser back/forward
- Forbidden/unknown route
- Small viewport expanded/collapsed navigation
- Keyboard and zoom navigation

### Candidate acceptance obligations

- Exactly one perceivable primary main landmark where appropriate; navigation names disambiguate multiple nav regions.
- Deep links/reload/back/forward retain correct view and authorized selection.
- No blocked content, clipped focus, unauthorized route exposure, or surprise geometry expansion.
- Layout shell/header/title areas align with the approved project baseline without clipping at supported widths.

### Observable independent probes

- Open authorized deep link, reload and go Back/Forward with selection retained.
- Keyboard navigate all destinations, inspect landmarks and narrow/zoomed rendering.
- Attempt forbidden route; verify denial without leaking content.
- Measure page title/header/navigation gutters, scroll regions and offscreen surfaces across supported routes and states.

### Escalate only the affected decision when

- New product information architecture or destination taxonomy.
- Conflict between existing route semantics and approved requirements.
- Permission mapping for a new destination is absent.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P02 — Record collection & search

**Intent:** Support finding, comparing and acting on records with correct semantics and efficient navigation.

### MUST choose / contextual decision rules

- Use a native HTML table for non-interactive tabular comparison.
- Use an ARIA grid only for genuinely composite keyboard cell navigation or editing and only with a verified implementation.
- Choose cards for heterogeneous records where side-by-side column comparison is not the dominant need.
- Use approved server paging/virtualization only when measured content volume requires it.
- When task and project contract require them, specify zebra-striping, frozen columns, user-driven resizing, persisted widths, grouping, context menus, badges and density preferences; otherwise preserve existing behavior.

### MUST NOT / anti-patterns

- Do not default to an ARIA grid for every table; it adds focus-management duties.
- Do not ship filter-only search that misrepresents server-filtered data.
- Do not make selection and row activation use an ambiguous single click.

### States to consider where applicable

- Default unselected
- Search/filter/sort
- Multiple selection and bulk actions
- No results vs no records
- Loading and page transition
- Stale, error, permission denial
- Keyboard focus with virtualization

### Candidate acceptance obligations

- Displayed rows and counts agree with query/sort/filter/page model.
- Selection stays unambiguous across pagination, filtering and deletion.
- Keyboard access, visible focus, row names and action scope work without mouse.
- No focus loss, wrong record activation, or hidden selection on virtualized rows.
- If resizing, pinning or grouping applies, column widths/order/focus and saved preferences persist correctly through sort/filter/reload.

### Observable independent probes

- Sort dates and numeric values with adversarial examples.
- Filter then change pages; confirm visible and selected records.
- Keyboard test row traversal or native table links and virtualization, if used.
- Exercise large rows, resize/pin/group, selection across filters, context menu keyboard access, theme changes and saved widths.

### Escalate only the affected decision when

- Destructive bulk semantics or select-all-across-pages remain undefined.
- Performance requirements demand a new virtualization strategy.
- Data ownership and permission model for hidden records are unclear.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P03 — Record detail & inspection

**Intent:** Expose record facts, context and transitions without obscuring ownership or edit risk.

### MUST choose / contextual decision rules

- Use the approved record-detail shell, named sections, and domain-native tabs when contexts are peers.
- Use progressive disclosure for supplementary information only, not required actions or errors.
- Use inspector/detail page based on task continuity, not aesthetics.

### MUST NOT / anti-patterns

- Do not collapse a specialized domain dossier into generic cards.
- Do not remove provenance, history or archived/read-only cues.
- Do not use a destructive modal as a passive record viewer.

### States to consider where applicable

- Viewing current record
- Switch related context/tab
- Read-only/archived
- Stale or concurrent edit
- Missing/deleted record
- Deep-link restoration
- Dirty navigation attempt

### Candidate acceptance obligations

- Record identity, relationship context and provenance remain visible as required.
- No unauthorized edits for archived/read-only records.
- Navigation retains user context and unsaved input is not silently discarded.

### Observable independent probes

- Navigate from list to record and back; reload a nondefault context.
- Open archived record and attempt editing.
- Simulate missing/deleted record and concurrent update.

### Escalate only the affected decision when

- New record relationship or provenance source lacks a product owner.
- Conflict about edit permissions or audit retention.
- Changing native investigative view taxonomy.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P04 — Form & editing workflows

**Intent:** Collect and modify user data with unambiguous validation, persistence and recovery.

### MUST choose / contextual decision rules

- Use inline editing for a bounded reversible field with known persistence behavior.
- Use grouped forms for coherent changes; step-by-step wizard only for genuine irreversible dependencies.
- Use native labeled inputs and established project validation primitives.
- Group fields by user task; use relational choices with trusted validity and progressively reveal advanced fields only without hiding mandatory information.

### MUST NOT / anti-patterns

- Do not create multi-step flows merely to hide complexity.
- Do not disable Submit without discoverable explanation.
- Do not silently discard typed changes or transform an optimistic save into a success without server acknowledgment.

### States to consider where applicable

- Pristine
- Editing/dirty
- Field invalid
- Pending async validation
- Submitting
- Server rejection
- Conflict/expired session
- Saved/confirmed
- Cancel/close with dirty draft

### Candidate acceptance obligations

- Every input has a programmatic label; help and errors are associated appropriately.
- Invalid data cannot silently pass; focus/announcements lead users to actionable errors.
- Repeat clicks do not double-commit; failures preserve draft and recovery path.
- Successful state reflects authoritative persisted result.
- Defaults and relational choices never introduce unauthorized or destructive data semantics.

### Observable independent probes

- Keyboard complete a form; submit both valid/invalid.
- Deny and timeout save; retry without duplication.
- Close/reload while dirty and simulate concurrent edit.

### Escalate only the affected decision when

- Unapproved irreversible effects or legally significant consent.
- Unknown validation authority or conflicting server/client rules.
- Unsaved draft recovery requirements unresolved.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P05 — Action placement & command hierarchy

**Intent:** Place actions so scope, priority, consequence and authorization are evident.

### MUST choose / contextual decision rules

- Primary action belongs near the affected workflow in the existing approved command region.
- Secondary and rare actions go to approved contextual menus with visible access alternatives.
- Bulk actions appear only when a defined selection exists; dangerous commands are separated.

### MUST NOT / anti-patterns

- Do not add a second toolbar merely because the feature has new commands.
- Do not make a hover-only control the sole access path.
- Do not expose disabled-looking actions that still execute.

### States to consider where applicable

- No selection
- Single selection
- Multiple selection
- Disabled with reason
- Permission denied
- Action pending
- Success/failure
- Destructive confirmation/undo where supported

### Candidate acceptance obligations

- Every action has an identifiable scope, accessible name and predictable effect.
- Permissions are enforced by trusted backend, not appearance.
- Dangerous actions require risk-appropriate friction and never misrepresent completion.

### Observable independent probes

- Exercise all actions using keyboard, with/without selection.
- Try denied action by direct API path and verify authorization boundary.
- Attempt repeated destructive trigger while pending.

### Escalate only the affected decision when

- Approval or irreversible action not covered by task grant.
- Unresolved destructive semantics or permission ownership.
- Adding commands would violate approved geometry.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P06 — Overlays, menus & dialogs

**Intent:** Present contextual choices and blocking interactions with correct focus and containment.

### MUST choose / contextual decision rules

- Use dropdown/popover for short nonblocking contextual options.
- Use modal dialog only when a blocking decision or task genuinely requires it.
- Choose project-native drawer/side panel when context must remain visible and pattern is approved.
- Anchor nonmodal surfaces to their actual triggering element; use verified edge collision placement and safe overflow containment.

### MUST NOT / anti-patterns

- Do not display passive information in a modal by default.
- Do not rely on hover-only popovers or trap keyboard focus in nonmodal overlays.
- Do not force-close a dirty dialog without explicit safeguard.

### States to consider where applicable

- Closed
- Opened via pointer and keyboard
- Nested menu
- Escape/cancel
- Viewport edge and scroll
- Validation failure
- Dirty close attempt
- Async pending
- Return focus

### Candidate acceptance obligations

- Dialog has accessible label, correct modality and focus management.
- Escape/close behavior conforms to actual pattern including dirty-draft protection.
- Popup is reachable and fits/repositions within supported viewport; no clipped actions.

### Observable independent probes

- Open/close using mouse and keyboard; verify focus return to sensible trigger.
- Test narrow/zoomed viewport with scroll and edge collision.
- Attempt close while dirty and while submit pending.
- At screen edges and zoom, test tooltip/popover collision, anchor tracking, scroll and focus restoration.

### Escalate only the affected decision when

- Nested modality would make focus ownership ambiguous.
- New irreversible approval/consent flow.
- Approved overlay size cannot fit required essential content.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P07 — Dashboards & analytical views

**Intent:** Help users make accurate comparisons with transparent measures and honest visualization.

### MUST choose / contextual decision rules

- Choose a chart only when shape, trend, ranking or distribution matters more than exact lookup.
- Choose a table when exact values or comparison of heterogeneous attributes matters.
- Select encoding by question: ordered categories for bars, continuous time for line trends, proportion only when denominator explicit.

### MUST NOT / anti-patterns

- Do not use truncated axes or normalized percentages without disclosure when misleading.
- Do not use 3D/decorative chart elements to imply significance.
- Do not invent missing data, error bars, denominators or categorical order.

### States to consider where applicable

- Loaded and sourced
- Filtering or time range change
- Missing/stale measurement
- Zero/empty observations
- Loading/error
- Small viewport
- Accessible alternative

### Candidate acceptance obligations

- Units, denominators, time range, aggregation and freshness are explicit.
- Axes, labels and color encodings do not distort meaning.
- Data table or equivalent text explains information without reliance on visual-only marks.
- Metrics disclose definition, unit, denominator, time range, source, freshness and applicable uncertainty before consequential use.

### Observable independent probes

- Cross-check sampled plotted values against underlying records.
- Test zero, missing, negative and extreme data; keyboard/AT alternatives.
- Resize and zoom with long labels and dense categories.
- Check chart update performance with representative large datasets and invalid/extreme series.

### Escalate only the affected decision when

- Metric definition, aggregation or ownership ambiguous.
- Analytical comparison requires statistical inference absent in approved scope.
- Risk of misleading consequential decision.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P08 — Monitoring & status

**Intent:** Communicate condition, urgency and freshness to support safe operational response.

### MUST choose / contextual decision rules

- Separate system condition (status), severity (impact), and actionability (what to do).
- Use stable human-readable labels, icons and timestamps; encode semantic categories with approved project tokens.
- Make unknown/stale distinct from healthy.

### MUST NOT / anti-patterns

- Do not communicate severity by color alone.
- Do not mark an unconfirmed operation successful.
- Do not make a noisy real-time update disrupt an in-progress task or focus.

### States to consider where applicable

- Healthy
- Warning
- Critical
- Acknowledged
- Stale
- Unknown
- Disconnected
- Recovered
- Pending user action

### Candidate acceptance obligations

- Severity and freshness can be understood without color.
- Unknown/stale is not rendered as normal.
- Refresh and transitions do not unexpectedly reset keyboard focus or user filters.
- Operational and alert severity meanings are stable across themes; no unconfirmed success/status claims.

### Observable independent probes

- Inject stale/unknown state; verify visible difference from success.
- Check focus stability under update frequency.
- Verify announcement urgency and that notices can be acknowledged/dismissed as appropriate.

### Escalate only the affected decision when

- Severity and escalation policy missing.
- Monitoring alerts could trigger an irreversible workflow.
- Conflicting status sources or timestamps.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P09 — Empty, loading, error & permission states

**Intent:** Represent operational and data availability states truthfully, with recoverable actions.

### MUST choose / contextual decision rules

- Use bounded skeletons for expected pending layouts only when they do not obscure progress.
- Differentiate empty dataset, no search results, permission denial, unavailable source and timeout.
- Offer retry only when safe and state-reconciliation rules are clear.

### MUST NOT / anti-patterns

- Do not turn outage into a comforting empty state.
- Do not spin forever without progress or timeout ownership.
- Do not automatically retry non-idempotent writes without reconciliation.

### States to consider where applicable

- Initial loading
- Long pending
- Empty by design
- Filtered no results
- Permission denied
- Offline/disconnected
- Timeout
- Partial results
- Canceled
- Recovered
- Filtered-empty distinctly from true empty
- Partial data distinctly from complete data

### Candidate acceptance obligations

- Each state explains what happened and what action is available.
- Sensitive information does not leak on denial.
- Retries preserve context and do not duplicate effects; errors log safe provenance.
- Only genuinely applicable state obligations are required; omitted states must have reviewed applicability rationale.

### Observable independent probes

- Inject 403, 404, 500, timeout, canceled request and partial source response.
- Verify semantics and permitted retry for reads versus writes.
- Check screen-reader status announcement without excessive repetition.

### Escalate only the affected decision when

- Write retry semantics unknown.
- Auth failure indistinguishable from source absence.
- Partial results could be mistaken for complete authoritative data.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P10 — Responsive adaptation & density

**Intent:** Maintain task access, information priority and user preferences across viewport and zoom.

### MUST choose / contextual decision rules

- Derive breakpoints from content failure and approved component behavior, not device labels alone.
- Allow overflow/scroll where preserving tabular comparisons requires it; use alternative detail view when approved.
- Respect actual font/zoom, text length, locale and safe effective density.
- Respect the approved supported viewport matrix; a documented desktop-only product does not acquire an unsupported mobile/touch layout obligation, while applicable zoom/reflow/accessibility obligations remain.

### MUST NOT / anti-patterns

- Do not globally increase spacing to repair one narrow viewport.
- Do not hide essential actions or change task meaning at mobile widths.
- Do not overwrite saved user density or panel widths with a new default.

### States to consider where applicable

- Wide
- Intermediate
- Narrow
- 200% and 400% zoom as applicable
- Long text/translation
- High-density saved preference
- Touch/keyboard
- Orientation change

### Candidate acceptance obligations

- No essential content loss or unapproved geometry growth.
- Content and controls remain operable at applicable reflow/zoom criteria.
- Requested preferences survive; safety minimum may affect effective dimensions without destroying stored request.

### Observable independent probes

- Capture paired bounding rectangles and visible row capacity at same viewport/state/profile.
- Exercise reflow, zoom, long labels and RTL where supported.
- Change density and navigate/reload; check persisted requested values.
- Measure supported desktop widths plus required text/zoom accessibility states; avoid inventing mobile design requirements.

### Escalate only the affected decision when

- Responsive priorities conflict with product-critical content.
- Existing approved layout cannot meet applicable accessibility requirement.
- No approved change allowance for required safety enlargement.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P11 — Visual tokens, typography & motion

**Intent:** Apply visual identity consistently without compromising contrast, perception or established geometry.

### MUST choose / contextual decision rules

- Resolve semantic tokens from approved project profile, with version pin and fallback behavior.
- Use native typography hierarchy, spacing steps and restrained motion per existing project.
- Prefer reduced-motion setting and semantic state colors where applicable.
- Map semantic light/dark tokens for surface, text, focus, positive/negative status, charts, overlays and controls to approved project design system rather than fixed colors.

### MUST NOT / anti-patterns

- Do not invent a universal brand palette or force B2.1 onto other apps.
- Do not use color token changes as cover for layout and padding alterations.
- Do not copy token values from untrusted tool output into authority without review.

### States to consider where applicable

- Light
- Dark
- High contrast/forced colors where supported
- Focus/hover/active/disabled
- Success/warning/error
- Reduced motion
- Font scaling

### Candidate acceptance obligations

- Semantic state differences remain perceivable and not color-only.
- Contrast meets applicable criterion for text and meaningful UI parts.
- Theme change does not alter unchanged geometry except documented exceptions.
- State tokens and type hierarchy obey actual approved project definitions; typography change does not silently inflate layout.

### Observable independent probes

- Inspect token resolution and theme/forced-color states.
- Check contrast of actual rendered foreground/background pairs.
- Compare dimensions of stable component fixtures before/after palette changes.

### Escalate only the affected decision when

- Unapproved brand identity or token source.
- Unknown contrast pair or state vocabulary.
- Requested motion would create an accessibility risk.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P12 — Accessibility, keyboard & semantics

**Intent:** Provide accessible semantics and interaction for keyboard, assistive tech and varied input modes.

### MUST choose / contextual decision rules

- Prefer native HTML semantics and tested library components; use custom ARIA widgets only when task requires them.
- Select APG pattern matching actual keyboard/focus behavior, not visual appearance.
- Define focus order, names, states, validation and announcements before implementation.

### MUST NOT / anti-patterns

- Do not add ARIA roles to override correct native semantics.
- Do not rely only on axe-like automated checks for assistive-tech quality.
- Do not treat WCAG 2.5.8 as proof every visible control must make a 24px-high row (exceptions and spacing apply).

### States to consider where applicable

- Keyboard-only
- Screen reader
- Touch pointer
- Zoom/reflow
- Focus after modal
- Validation error
- Disabled/denied
- Forced colors and reduced motion

### Candidate acceptance obligations

- Applicable WCAG 2.2 AA criteria met with documented exceptions where allowed.
- Programmatic name/role/state and focus behavior accurately match controls.
- Manual assistive-tech evaluations cover critical flows when applicable.

### Observable independent probes

- Keyboard every critical task without pointer.
- Real screen reader focus and announcements for dialog, grid and form.
- Inspect target dimensions plus spacing/equivalent exceptions under 2.5.8.

### Escalate only the affected decision when

- New custom widget lacks tested keyboard pattern.
- Conflicting accessible behavior and approved compactness.
- Missing actual assistive tech or owner required for mandatory acceptance.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P13 — Collaborative and persistent state

**Intent:** Preserve drafts and preferences, prevent stale overwrites and make shared changes understandable.

### MUST choose / contextual decision rules

- Define authoritative persisted state, pending edits and conflict resolution per workflow.
- Use versioned preferences and saved views with explicit precedence.
- Make autosave progress and conflicts observable without repeating noise.

### MUST NOT / anti-patterns

- Do not silently discard dirty state on navigation or update.
- Do not treat client optimistic state as authoritative server persistence.
- Do not clear saved preferences to fix a migration issue.

### States to consider where applicable

- Clean
- Dirty
- Autosaving
- Saved
- Save failed
- Conflict
- Offline
- Concurrent change
- Version mismatch
- Restore saved view

### Candidate acceptance obligations

- Draft and user preferences are preserved according to documented policy.
- Concurrent change either merges safely per approved semantics or blocks with choices.
- Version migrations preserve requested settings even when effective safety constraints differ.
- Autosave/conflict and input persistence cover failed network calls, retry idempotency, and eventual authoritative server confirmation.

### Observable independent probes

- Simulate concurrent editors, restart, offline and retry.
- Verify dirty close guard, confirmation, restore and schema migration.
- Test unauthorized access to other users saved state.

### Escalate only the affected decision when

- Ownership or retention of shared state undefined.
- Automated conflict merge could destroy data.
- State migration cannot preserve a value or is incompatible.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.

## P14 — Content, localization & feedback

**Intent:** Use precise language and feedback that supports task understanding across locales and expertise.

### MUST choose / contextual decision rules

- Use product vocabulary already approved, clear action verbs and short next steps.
- Externalize localizable text and handle plural, date/number and bidirectional rendering with approved utilities.
- Make actionable feedback tied to the actual state and severity.

### MUST NOT / anti-patterns

- Do not promise success before verification.
- Do not localize code keys or inject untranslated dynamic values without escape.
- Do not use vague buttons like Okay for irreversible actions.

### States to consider where applicable

- Default locale
- Longest supported translation
- RTL where supported
- Missing localized string
- Error/permission denial
- Long validation text
- Success and undo feedback

### Candidate acceptance obligations

- Labels and validation remain comprehensible and consistent with domain terminology.
- Direction/long text do not clip essential controls.
- Feedback is timely, actionable, and accurately reflects authoritative outcome.

### Observable independent probes

- Run pseudo-localization or long-string fixtures at supported breakpoints.
- Review high-risk action/error microcopy with language expert.
- Verify status announcements and focus when feedback appears.

### Escalate only the affected decision when

- Legal, safety or regulated copy not approved.
- Missing domain translation owner.
- Conflicting terms could alter decision meaning.

**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.
