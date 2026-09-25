# Historical OUT-13 Deployment Readiness Snapshot

> Preserved pilot-era guidance and audit context. The current production lifecycle
> is maintained in [DEPLOYMENT.md](../DEPLOYMENT.md).

This document is the current `OUT-13` deployment-readiness baseline for a 2 to 4 day team pilot.

Status: `PARTIAL`

Reason:

- Local and source-level deployment hardening is in place.
- Runtime diagnostics, readiness, and External export contract checks are now deploy-focused.
- `startup-check` is now sanitized for team-pilot safety and does not return raw DB URLs, file paths, tenant DB URLs, or sensitive identity values.
- Final company-domain proof is still blocked on a real work-environment browser run.

Temporary conclusion stance:

- `OUT-13` is ready for work-domain verification.
- `OUT-13` is temporarily concluded for transition into the next dedicated deployment/data-durability goal.
- `OUT-13` is not Done until the copied work-domain diagnostics report is reviewed.

## Deployment Environment Matrix

| Mode | Frontend Origin | API Base URL | Auth / Proxy Behavior | CORS Requirement | Cookies / Credentials | Diagnostics Expectation | External Export Expectation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Local direct | `http://localhost:<frontend-port>` or same-origin local host | Explicit backend origin such as `http://localhost:8000`, or blank when local proxy is intentionally used | No company OAuth expected. Direct browser-to-backend or local dev proxy. | Required only when frontend and backend are on different local origins. | Same-origin requests use `same-origin`; cross-origin local requests use `include`. | Environment Summary should show local direct or same-origin runtime. Backend Reachability and External Export should be `PASS` or targeted `PARTIAL`. | Manifest, CSV, and preview should pass. Preflight risk may be `PARTIAL` if custom identity headers cross origins. |
| Company-domain dev | Company-routed dev URL or forwarded company URL | Company-routed backend origin or same-origin company proxy path | Browser may cross proxy, SSO, OAuth, and header-rewriting layers. Redirects to login are deployment failures for API JSON routes. | Exact frontend origin must be allowed when runtime is cross-origin. Same-origin proxy mode is preferred. | Same-origin stays `same-origin`; cross-origin company routing uses `include`. | Startup diagnostics should show company-ready origin alignment. Any OAuth redirect, backend JSON mismatch, or loopback API base is a `FAIL`. | `PASS` is ideal. `PARTIAL` is acceptable only for unreadable custom headers with valid manifest fallback. |
| Production-like | Official deployed company frontend route | Official backend route or official same-origin company routing | Full company routing, SSO, and proxy policy should already match expected production behavior. | Must be explicit and stable. Wildcard expose-header behavior is not acceptable. | Must preserve authenticated browser session behavior without exposing secrets. | Environment, backend, and transport cards should be clean. Any stale bundle mismatch or routing drift should surface before pilot expansion. | External manifest-backed export/import round-trip should pass from actual browser runtime. |

## Runtime Validation Rules

SysGrid now treats the following as explicit runtime checks:

- missing API base URL
  Allowed only when the deployment is intentionally same-origin or relative-proxy based.
- invalid API base URL
  Fails fast when the configured base is neither blank, root-relative, nor an `http/https` origin.
- frontend origin mismatch
  Fails when a hosted/company frontend still points at `localhost` or `127.0.0.1`.
- backend unreachable
  Reported through `/api/v1/readiness` and `/api/v1/settings/startup-check`.
- manifest endpoint unreachable
  Reported through the External Export Contract diagnostics card.
- redirect or OAuth response where backend JSON was expected
  Reported by startup diagnostics, readiness checks, and JSON client helpers.
- wildcard expose headers on app-generated direct response
  Reported as a transport failure.
- stale frontend bundle risk if detectable
  Reported when the frontend bundle version differs from the backend’s frontend-version hint.

## Corporate Cloud Primary Publish Path

The primary deployment contract is the corporate cloud's two independently
published projects. Preserve these project boundaries even when optional local or
on-premises packaging is added later:

1. **FastAPI project:** publish from `backend/`.
2. **Node/React project:** publish from `frontend/`.

Docker and Compose are optional compatibility tools only. They must never become
a prerequisite for either corporate project, combine both projects into one
mandatory image, or replace the native build/start contracts below.

### FastAPI project

Use the corporate FastAPI publisher from `backend/`. Keep `requirements.txt` for
platform discovery and keep `requirements.lock` as the deterministic dependency
contract. Where the publisher supports a custom install command, prefer the lock:

```bash
cd backend
python -m pip install -r requirements.lock
python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

If the platform owns the Uvicorn command, configure the application target as
`app.main:app`. Do not enable production startup migration implicitly. Health and
readiness remain:

- `GET /api/v1/health`
- `GET /api/v1/readiness`

### Node/React project

Use the corporate Node/React publisher from `frontend/` and preserve the lockfile:

```bash
cd frontend
npm ci
npm run build
```

Publish `frontend/dist/` through the platform's React/static output contract. Set
`VITE_API_BASE_URL` to the separately published FastAPI origin when the projects
do not share an origin. Keep `VITE_IDENTITY_MODE=trusted_proxy`; browser code must
not assert the trusted user header. A blank API base remains valid only when the
corporate ingress intentionally supplies same-origin `/api` routing.

### Source-level corporate publishability guard

Run the read-only guard from the repository root before either project is
published:

```bash
python scripts/corporate_publishability_guard.py
```

The guard verifies independent roots, native dependency/build manifests, the
FastAPI entrypoint and safe endpoints, separate-service frontend routing, trusted
proxy behavior, and the production environment examples. It does not require
Docker, network access, credentials, or a live corporate deployment. Real cloud
publish success must still be verified in the corporate environment.

## Required Safe Endpoints

- `GET /api/v1/health`
- `GET /api/v1/readiness`
- `GET /api/v1/settings/startup-check`
- `GET /api/v1/import/snapshot/external_entities/manifest`

`/api/v1/readiness` now reports only safe facts:

- app alive
- API prefix and version
- import/export contract availability
- External schema version
- server timestamp
- sanitized environment mode
- frontend build version hint when detectable

`/api/v1/settings/startup-check` now reports only sanitized deployment facts:

- API prefix
- request origin and request base origin
- whether the request origin is allowed by CORS
- configured CORS origin count
- whether `VITE_API_BASE_URL` is configured
- whether `VITE_API_BASE_URL` incorrectly includes `/api/v1`
- sanitized configured API origin
- whether the default user is still the fallback
- whether the identity env value is present
- whether a selected tenant is present
- accessible tenant count
- frontend build version hint
- import/export contract summary
- warning list

## Team-Pilot Operator Flow

1. Open the deployed app in the target browser.
2. Go to `Settings -> System Diagnostics`.
3. Click `Run All Checks`.
4. Review:
   - `Environment Summary`
   - `Backend Reachability`
   - `External Export Contract`
   - `Transport / Preflight Risk`
5. Click `Copy Full Report` and attach the output to the pilot run log.

## Known Readiness Limits

- Startup diagnostics are now safe for a team pilot, but OUT-13 remains `PARTIAL` until a copied work-domain diagnostics report is attached.
- Real company-domain proof is not yet attached.
- Cross-origin company deployments may still show `PARTIAL` transport risk when custom identity headers force preflight.
- Large frontend bundle warnings still exist at build time, but they are not currently blocking the pilot.

## Related Pilot Docs

- [OUT-13 team pilot checklist](OUT-13-team-pilot-checklist.md)
- [OUT-13 rollback and recovery](OUT-13-rollback-plan.md)
- [OUT-13 deployment risk register](OUT-13-deployment-risk-register.md)
- [OUT-13 temporary conclusion handoff](OUT-13-temporary-conclusion-handoff.md)
- [OUT-13 final review manifest](OUT-13-final-review-manifest.md)


## Production Safety Gate

A production process now refuses startup when the identity, CORS, host, database, tenant-storage, public-readonly, or auto-admin contract is unsafe. Copy and customize:

- `deploy/backend.env.production.example`
- `deploy/frontend.env.production.example`

The reverse proxy must strip any incoming client copy of `TRUSTED_PROXY_USER_HEADER`, authenticate the request, and inject the verified identity header. The frontend must use `VITE_IDENTITY_MODE=trusted_proxy`, which prevents the browser from sending `X-User-Id`.

Run the source-level gate from the repository root:

```bash
python scripts/production-preflight.py
```

The preflight intentionally reports missing lockfiles as deployment blockers. It does not replace the full Playwright suite, a company-domain browser run, or the backup/restore drill.

## Production Workhorse Data-Safety Gate

Production startup no longer mutates database schemas by default. In production,
`AUTO_MIGRATE_ON_STARTUP=true` is ignored unless the operator also explicitly sets:

```bash
ALLOW_AUTO_MIGRATE_IN_PRODUCTION=true
```

The preferred production flow is operator-managed: verify configuration, create a
transaction-consistent snapshot, restore it in isolation, rehearse migrations on
the restored copies, and only then start or upgrade the live service.

### One-command durability verification

Set explicit production database URLs and a persistent backup root, then run:

```bash
export CONFIG_DATABASE_URL='sqlite+aiosqlite:////srv/sysgrid/data/config.db'
export DATABASE_URL='sqlite+aiosqlite:////srv/sysgrid/data/default.db'
python scripts/production_data_guard.py verify \
  --backup-root /srv/sysgrid/backups
```

The command runs the existing production configuration preflight, creates an
online SQLite snapshot using the SQLite backup API, restores it to an isolated
drill location, verifies hashes and SQLite integrity, and runs Alembic only
against restored tenant/default database copies. It emits an operation ID and
returns nonzero on any unsafe or unverifiable condition.

### Snapshot only

```bash
python scripts/production_data_guard.py snapshot \
  --output-root /srv/sysgrid/backups
```

Every completed snapshot contains a versioned `manifest.json` with logical roles,
relative filenames, sizes, SHA-256 checksums, and integrity results. It excludes
raw database URLs, credentials, and absolute live source paths. Interrupted
snapshots are removed and never leave a valid-looking final manifest.

### Isolated restore drill

```bash
python scripts/production_data_guard.py restore \
  --snapshot /srv/sysgrid/backups/snapshot-... \
  --target-root /srv/sysgrid/restore-drills/restore-001
```

Restore refuses nonempty targets, absolute/traversal manifest paths, checksum or
size mismatches, and failed SQLite integrity checks. Stage 1 intentionally has no
live overwrite mode.

### Migration rehearsal

```bash
python scripts/production_data_guard.py rehearse \
  --snapshot /srv/sysgrid/backups/snapshot-...
```

Alembic is run only against restored default/tenant database copies. The config
database is restored and integrity-checked but remains managed by SQLAlchemy
`create_all`, not Alembic; this limitation is reported explicitly.

### Safe startup and rollback rule

1. Stop writes or place the application in the approved maintenance state.
2. Run the one-command durability verification and preserve its operation ID.
3. Keep production startup schema management operator-controlled.
4. Deploy the new application version.
5. Confirm `/api/v1/health` and `/api/v1/readiness`.
6. If rollback is required, stop the application and restore the approved
   snapshot to a new isolated data root first. Stage 1 never overwrites live data.

### Tenant registry integrity

Audit registry state before a maintenance drill:

```bash
python scripts/production_data_guard.py audit
```

An active tenant or required config/default database whose file is missing is a
hard blocker. Restore or correct that registration before production startup.
An inactive tenant whose file is already missing is not backed up; the omission
is recorded in the snapshot manifest under `omitted_inactive_databases` with
only sanitized tenant metadata and the missing filename. Existing inactive
database files are still included in snapshots.

Inactive tenants are excluded from request routing, tenant selection, and the
normal user tenant list. The administrative tenant registry remains the place
to inspect inactive/offline records.

### Verified test-registry residue reconciliation

Backend and browser test runs must never write tenant registrations into the
configured live `config.db`. The backend pytest harness now selects test mode
before importing application settings, overrides both config and tenant database
dependencies, rebinds stale direct `ConfigSessionLocal` imports to the per-test
temporary registry, and fails the test session if the configured live config
database hash changes.

For an already contaminated registry, preview only the narrow, reversible
reconciliation plan first. The classifier accepts only missing active rows with
strong test provenance such as pytest temporary paths, backend tenant-workflow
names, tenant-isolation names, or timestamped Blank-Slate/Switch/Empty-States
names:

```bash
python scripts/production_data_guard.py reconcile-test-residue \
  --expected-candidates 80
```

Apply requires a stopped application, an exact expected candidate count, an
external evidence root, and two explicit acknowledgement tokens:

```bash
python scripts/production_data_guard.py reconcile-test-residue \
  --expected-candidates 80 \
  --evidence-root "$HOME/sysgrid-production-drills" \
  --maintenance-token APP-STOPPED \
  --apply-token DEACTIVATE-VERIFIED-TEST-RESIDUE
```

The operation creates an online backup of `config.db`, records before/after
hashes and a sanitized candidate list, and only changes `tenants.is_active` from
true to false. It never deletes tenant rows, access rows, or database files. Any
active missing row without verified test provenance blocks the entire operation.
After reconciliation, rerun `audit`, then the controlled snapshot/restore/
migration drill.

### WAL-safe invariance evidence

Do not use the SHA-256 of the SQLite main `.db` file alone to prove that a
live database was unchanged. A committed transaction can remain in `-wal`
while the main file bytes stay identical. Production drills must compare
`sqlite_logical_fingerprint()` values captured through read-only SQLite
transactions before and after the isolated operation. Main-file hashes remain
useful artifact diagnostics, but they are not the acceptance signal.
