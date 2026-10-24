# Desktop Asset configuration and Map follow-up

The product scope is desktop only. This pass follows the qualified desktop
workspace batch and retains its Report, Racks, theme and notification foundations.

## Confirmed problems and changes

- Settings accepts custom Asset types, statuses and environments, but the single
  Asset editor previously offered canonical values only. The editor now merges
  configured labels and its current value with the canonical choices. Loading,
  failure and explicit recovery preserve the draft. Asset settings requests reject
  HTTP failures and malformed list responses instead of caching them as choices.
- Logical-system filters retain observed systems alongside configured systems.
- Editor header badges display configured labels and retain their semantic color
  values. Long badge text is contained, with the full label available on hover.
- A read-only, settled-canvas observation of the prior production build found a
  lone node at 32x zoom: its label was painted at y=504 in a 432px canvas on all
  30 observed frames. Map zoom is now bounded at 8x; fit leaves room for labels.
  Canvas labels are measured and abbreviated to 160 screen pixels, while escaped
  hover text, the connected-assets list and selected details retain the full name.
  Node painting, selection, hit geometry and directional links remain intact.
- Singleton Map counts and a one-parameter Settings group use singular wording.

## Acceptance evidence required

The desktop browser gate retains its existing 49 cases and adds six: configured
values survive create/edit round trips, failed/delayed option recovery retains
recorded values and drafts, and singleton labels stay inside the settled canvas
at 1024, 1440 and 1920px. Both supported themes are covered. Native Chromium,
Firefox and WebKit must also preserve the earlier Report/Map/form regressions.
The normal-user and root-preview selections remain intact; no test timeout,
retry allowance or failure assertion is relaxed.

These local and CI checks do not constitute company deployment acceptance.
Identity, role permissions, persistence, recovery and capacity still require
evidence from the actual deployment environment.
