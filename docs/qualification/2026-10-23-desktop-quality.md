# Desktop workspace quality

The owner confirmed that SysGrid is a desktop-only product. New work targets
desktop browser windows, short laptop screens, keyboard use, theme consistency,
large inventories and truthful saves. Existing narrow-window fallbacks and
historical regression tests remain available; they do not establish a mobile
product requirement.

## Product corrections

- Asset creation and Report share canonical type, status and environment choices.
  Report additionally exposes configured and recorded historical values, so a
  retired category remains filterable without rewriting it. Previous Report
  filters omitted PDU/UPS, Planned/Standby and Dev/QA/DR/Sandbox/Legacy.
- Report uses one compact record header and one persistent nine-section navigator.
  Identity, actions, addresses and the recorded update time remain available.
  All nine sections, embedded tables, graphs and detail/console actions remain.
  Rail hostnames have their own wrapping line; status badges no longer compete
  with or truncate the primary record identity.
  Its status colors follow shared status badges; Planned and Standby are no
  longer rendered as failures. Failed receives an explicit shared danger color.
- Topology links, arrows and the legend use the same active-theme colors. Light
  mode uses darker network and dependency colors instead of translucent pale
  colors. Existing framing, pointer geometry and selection ownership remain.
- Form guide activation places keyboard focus on the section's first enabled
  field. Completed steps also expose text to assistive technology.
- Short desktop windows keep Report in a bounded pane. Section jumps scroll that
  pane and retain its section navigation; the app shell itself cannot scroll away
  its global header. Shared Planned and asset danger badges use readable dark
  foregrounds on raised surfaces. Form guide names and hint descriptions remain
  separate, avoiding a second control labeled like a record field.
  Narrow desktop windows also retain at least 320 pixels of record space. When
  a section is requested, the workspace scrolls enough to expose the record pane
  before its own section scroll, retaining the fixed global header.

## Verification boundaries

Regression tests cover the omitted Report values, actual filtering and historical
categories; canvas link/reverse-arrow color ownership; keyboard section entry;
and existing selection/resize contracts. The desktop browser gate adds both
themes at 1024, 1280, 1440 and 1920 pixels wide, including a 650-pixel-high laptop
window. It checks visible section navigation, populated Report contrast, actual
painted network color/contrast and keyboard Map selection. Original tests, retries
and timeouts remain unchanged.

Required evidence is the exact immutable patch, complete-index whitespace check,
original frontend/typecheck/build reports, native desktop browser results and
protected CI originals. This document describes the change contract; execution
receipts supply the pass/fail verdict. Company HTTPS identity, concurrent real
users, deployment recovery, capacity and an authentic engineer pilot remain field
acceptance requirements in `docs/production-field-qualification.md`.

Lesson: a shared component name does not prove that its choices or status colors
agree with the record editor. Compare valid recorded values and outcomes. Native
R1 failures exposed insufficient Planned contrast, unbounded short-window Report
scrolling and a guide/field accessible-label collision. Geometry and a controlled
style/scroll probe retain the causal evidence; do not erase or retry those runs.
R2 additionally exposed later generated utility rules overriding two selectors;
computed geometry and a controlled selector-only probe demonstrated the cause.
Its WebKit contrast evidence also captured white text on a deselected light rail
during a color transition. Report selection colors now switch immediately,
including the badge, preserving contrast through rapid record changes.
The R4 cascade trace localized a remaining one-frame delay to the global
reduced-motion duration rule, which creates transitions on child text even when
the button itself does not transition. A controlled 30-frame probe removed all
animations and restored correct first-frame colors by disabling transitions on
the complete rail item subtree. The correction is scoped to Report selection.

Next rule: every selectable asset classification must remain discoverable in
Report, and every theme-sensitive topology color must be measured as painted.
