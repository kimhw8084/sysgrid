# Desktop release qualification - 2026-09-29

The System Management V1 candidate is ready for desktop visual review and
company-environment deployment qualification. It is running locally with
representative demonstration data. Company production rollout is not yet proven.

Product code revision: `70e560306f1c5afca4368e965663e7f3ebc78295`.
Scope: Home, Assets, Monitoring, Services, Network, Racks, Audit Logs and
Settings/Access. Preview modules retain their explicit System Root boundary.
The owner's latest instruction authorizes direct implementation, validation and
launch; historical user-terminal ZIP handoffs are superseded for this cycle.

## Verified evidence

| Check | Result |
| --- | --- |
| Fresh locked backend installation | Python 3.14.5; dependency consistency passed |
| Full backend regression | 362 passed; five deprecation warnings |
| Frontend unit tests | 751 passed in 145 files |
| Typecheck, operational contracts and production build | Passed |
| Normal-user browser workflows | 91 passed; two expected unreleased-module skips |
| Desktop browser gate | 30 passed, including final control and text contrast changes |
| System Root preview boundary | One passed |
| Operational script tests | 58 passed |
| Snapshot, restore, migration and startup rehearsal | All 10 checks passed on synthetic data |
| Locked frontend and backend dependency audits | Zero known vulnerabilities reported |
| Built-app review capture | Eight major views in both themes; 16 screenshots |

Frontend qualification used Node 22.23.2 and Chromium 148.0.7778.96. The desktop
gate covers 1024, 1280, 1440 and 1920 px widths. Final screenshots use 1440 x 900.
The normal-user and System Root gates passed before the last color-only control
adjustment; the full frontend suite and all 30 desktop cases passed afterward.
No functional workflow code changed after those workflow gates.

The local review contains 200 assets, six populated racks, 278 services,
120 connections and 72 monitoring definitions. Audit samples are actual
create/update activity against the isolated review tenant. Screenshots do not
represent imported company data or live operational observations.

## Repaired issues and rollback boundaries

The original dense rack layout is retained. Saved themes now own their appearance
independently of OS settings. Grid values, status badges, Audit operations and
selected toolbar actions have readable theme-specific text. Rendered contrast,
font loading, toolbar clipping, shell overlap and rack equipment geometry have
browser checks. These checks do not constitute a whole-app accessibility audit.

Stale bulk previews cannot reopen dismissed dialogs or claim newer results.
Undo entry points share a single in-flight operation. Service form submission
now rejects repeated Enter presses while saving; a failed save retains the draft
and an explicit retry creates one record. Negative controls reproduced the
duplicate submission and bulk ownership defects before correction.

| Boundary | Commit |
| --- | --- |
| Original pre-Astra revision | `902ba0e823eafc71c52cd02e404828d65b3d7281` |
| First Astra source commit | `b5fffc2f7b464c1fc1409c226b0811c02bab022f` |
| Previous accepted UI revision | `57a49128fc40965ae51b1d568b5fb72ce5760789` |
| First commit in this qualification batch | `624c7b80` |
| Final product code in this batch | `70e56030` |

The batch has 11 separate commits for themes, the desktop gate, async bulk
ownership, Node support, Vite exposure, tooling dependencies, Router security,
Python support, malformed-request testing, duplicate submission and contrast.
Use individual Git reverts to undo a specific change. Preserve database backups
and follow the lifecycle recovery procedure for a deployed release; reverting
source is not a substitute for restoring production data.

## Remaining company go-live work

1. Configure the corporate frontend and FastAPI projects, HTTPS origins, trusted
   ingress and actual managed desktop browser. The evidence here is Chromium;
   Internet Explorer compatibility has not been established.
2. Supply the production identities, secret-manager signing key, release identity,
   persistent SQLite/config/tenant paths and restricted backup destination using
   the examples in `deploy/`. Verify that ingress strips spoofed identity headers
   and injects only an authenticated identity.
3. Run the production preflight and lifecycle qualification with the real injected
   configuration and storage. Rehearse restore on the actual backup destination,
   assign the backup/recovery owner, then apply migrations under the documented
   no-write maintenance procedure.
4. Validate representative company data, role restrictions, concurrent workloads,
   response-time targets and recovery on the company domain. Complete a team
   pilot and the owner's final visual review before opening general access.

See [the production lifecycle guide](../../DEPLOYMENT.md) for the operator path.
The local URL is `http://127.0.0.1:5173`; it is available on the review Mac only
and uses a development identity. It must not be exposed as the company service.

Known qualification limits: five backend deprecation warnings remain; the build
reports two large shared chunks; aggregate frontend statement coverage is 22.18%
across the repository, including unreleased areas. Passing checks and visual
review reduce regression risk; they do not prove zero bugs, pixel perfection in
every state, production traffic capacity or company-domain SSO behavior.

## Approved Soft Carbon follow-up - 2026-09-29

The owner selected Soft Carbon from five captures of the actual Assets view.
Dark mode now uses a neutral `#252525` canvas, `#303030` panels, `#e1e1e1` text,
and gray navigation/actions. Existing `nordic-frost-v1` and `dark` preferences
remain compatible. The preceding release record describes the earlier batch;
this follow-up changes only appearance and the dark-choice color swatch.

The rack equipment rectangles, density, fonts, table geometry, and light-theme
colors are preserved. The dark-choice swatch now shows the chosen gray even when
Light is selected. Legacy grid badge text uses brighter neutral and semantic
colors where the lighter background otherwise reduced contrast, including
selected rows. Equipment status and site colors retain their existing meaning.

Validation: typecheck, production build, and theme compatibility unit test passed.
The 30-case desktop suite passed; after final badge refinements, the eight affected
dark-theme cases passed again at 1024, 1280, 1440, and 1920 px. The built app was
captured in all eight major views in both themes. Before/after measurements
confirmed unchanged geometry and light-theme colors except the dark-choice
swatch. All 1,719 sampled populated-grid text checks passed, including selected
rows; the lowest measured ratio was 4.64:1 against a 4.5:1 requirement. This is
the sampled surface coverage, not a claim of whole-app accessibility compliance.

The palette is isolated in one follow-up commit. Its parent,
`621e0428f13f77e28683b61f304e7088e49b05c9`, is the rollback boundary. No backend,
data, permissions, or workflow behavior changes are part of this update.
