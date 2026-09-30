# Soft Carbon popup and interaction audit — 2026-09-29

The popup and notification repair batch is implemented and running in the local built
app. This record covers the approved desktop experience. It does not certify every
possible application state or replace company-environment deployment qualification.

## Repaired behavior

| Area | Defect and resulting behavior |
| --- | --- |
| Notification consistency | Ordinary success/error/info, promise/loading, and reversible notifications now use one card, semantic icon, detail text, accessible X, and bottom time gauge. |
| Notification timing | The gauge and dismissal share the same pause clock. Hover and keyboard focus pause expiry; loading remains until resolved. |
| Notification lifecycle | Unmounting one toast no longer disconnects the stack's store subscription and freezes subsequent messages. |
| Notification recovery | Revert asks for confirmation, prevents repeated submissions, remains while a request is pending, and keeps failed recovery available for retry. |
| Notification placement | A bounded stack at the lower left avoids covering modal header close controls; additional notices scroll within the stack. |
| Purge recovery | Every Assets purge entry point clears obsolete recovery notifications when execution starts. |
| Palette inheritance | Legacy navy/slate surfaces, borders, inset areas, and text inherit neutral Soft Carbon tokens. Semantic status and equipment colors remain meaningful. |
| Action contrast | Filled success, warning, and danger controls use readable text in both themes. The site-creation button was corrected after a rendered contrast failure. |
| Dropdown coordinates | Shared menus clamp to the viewport, flip when their preferred side loses usable space, and recalculate after resize and scroll. |
| Modal layering | Dialogs and their child selectors render above their owning surfaces. Maximized dialogs no longer cover discard confirmations. |
| Keyboard ownership | Escape closes the innermost popup, focus returns to its opener, and dialog Tab handling includes owned portal controls. |
| Dirty-form clarity | Cancellation says “Keep editing”; site and rack editor drafts require explicit discard. |
| Hover details | Disabled explanations, linked counts, activity indicators, Settings membership details, PDU hints, and connection hover cards escape clipping containers and use bounded surfaces. |
| Row menus | Row action menus use the triggering surface's layer and recalculate geometry when the desktop window changes size. |
| Rack menus | Rack, site, Add, and equipment menus render outside clipped rack containers. The portal/animation combination that prevented rack/site menus from rendering is corrected. |
| Rack dialogs | Site/rack editors, infrastructure history, audit, cable labels, plans, asset details, restore and confirmation surfaces use shared dialog layers. Draggable impact windows remain within the viewport. |
| Settings and Audit | History, snapshot and payload dialogs use shared placement, focus and palette rules. |
| Shell dialogs | Search, error console, patch notes, environment details, and Assets quick look use shared portal/layer behavior. |
| Search | Escape works with no results; obsolete requests cannot overwrite a newer query or a closed search. |
| Error-console copy | Copy confirmation appears only after the clipboard operation succeeds. |
| Native prompts | Source-owned browser alert/confirm/prompt calls were replaced in Settings, Services, Monitoring, External, Projects and Intelligence. Browser-owned print, file chooser, date picker and unload UI remain controlled by the browser/OS. |

The original dense rack spacing and mounted equipment geometry are preserved.

## Evidence

- Frontend unit suite: **761 passed in 148 files**. After the final “Keep editing”
  label change, all 23 affected accessibility/dirty-form tests passed again.
- TypeScript check, operational contracts and production build: **passed**.
- Normal-user browser workflows: **91 passed, 2 expected unreleased-module skips**.
  This run preceded the preview-only native prompt replacements and the final
  cancellation label; those changes received the unit, boundary and desktop checks.
- Explicit System Root preview access boundary: **1 passed**.
- Final desktop browser gate: **35 passed** in one clean run. All eight released
  views were checked in both themes at 1024, 1280, 1440 and 1920 pixel widths.
- New popup browser cases cover both themes at 1024 and 1440 pixels, resize to
  650 pixels high, bounding boxes, overlay hit testing, rendered text contrast,
  nested selector focus, maximized import discard, notifications, PDU tooltip,
  site dirty cancellation, site actions, error console and empty search.
- An actual test record was archived and restored through the toast Revert flow.
  The test checks the restore response and the record's return to the grid.
- The built app was captured in all eight released views at 1440 × 900 with
  200 assets, 6 racks/134 mounted assets, 278 services, 120 connections and
  72 monitoring definitions. These are synthetic review records.
- The capture run recorded no page exceptions or horizontal document overflow.
  It is a single-browser localhost observation, not a production load test.

Earlier failed runs exposed real toast/menu/contrast defects and two inaccurate
test selectors. The fixes were followed by focused reruns; no retries or timeouts
were raised and no accessibility/geometry checks were removed.

## Git boundaries

Branch: `codex/astra-sysgrid-quality`.

| Change | Commit |
| --- | --- |
| Before this audit; approved Soft Carbon | `53768154ab6e77b2b1b238dcd43ae1f10b572732` |
| Shared overlay, focus, tooltip and dialog foundations | `5289b625` |
| Soft Carbon compatibility and unified toast renderer | `cd2120e1` |
| Released-workspace menu and dialog repairs | `5a147e66` |
| Preview native prompt replacements | `b5733b20` |
| First Astra source commit in the development history | `b5fffc2f7b464c1fc1409c226b0811c02bab022f` |
| Original pre-Astra source | `902ba0e823eafc71c52cd02e404828d65b3d7281` |

The following test/evidence commit records the final gate. To undo this whole
audit, revert its commits in reverse order back to `53768154`; later commits
depend on the shared foundation. No push, deployment, database migration or
backend source change is part of this batch.

## Coverage limits and next decision

The released-view desktop checks cover Home, Assets, Monitoring, Services,
Network, Racks, Audit Logs and Settings/Access. Preview modules inherit the
shared fixes and their native prompts have been replaced; their complete
functional and visual state spaces have not been production-qualified.

The evidence covers Chromium 148 on the review Mac. It does not establish
Internet Explorer compatibility, every tooltip at every possible data length,
all assistive-technology behavior, zero defects, company SSO, concurrency
capacity or production recovery. Two existing large-chunk build warnings remain.
Backend regression evidence belongs to the previous release record and was not
rerun as a full backend suite for this frontend-only batch.

The app is available for final desktop review at `http://127.0.0.1:5173/asset`
on the review Mac. Company go-live still requires the configuration, ingress,
backup/restore and pilot steps in [the desktop release record](2026-09-29-desktop-release.md).
