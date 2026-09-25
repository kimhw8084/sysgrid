# SysGrid Production Lifecycle

This is the current production operator guide for System Management V1: Home,
Assets, Monitoring, Services, Network, Racks, Audit Logs, and Settings/Access.
It defines source-side qualification and the supported corporate publish path.
It does not claim company-domain, proxy, SSO, or browser field proof.

The pilot-era OUT-13 checklists and status are preserved in
[the historical deployment snapshot](docs/OUT-13-historical-deployment-readiness.md).

## Corporate Cloud Primary Publish Path

The corporate platform publishes two independent projects:

1. **FastAPI project:** source root `backend/`, application target `app.main:app`.
2. **Node/React project:** source root `frontend/`, build output `frontend/dist/`.

Docker and Compose are optional compatibility tools. Process supervision,
service restarts, proxy routing, TLS, and traffic shifting belong to the corporate
platform. This repository does not require Docker, Compose, systemd, or a new
daemon.

## Prerequisites and deterministic install

Use Python 3.11 or newer, Node.js 20 or newer, npm 9 or newer, and file-backed
SQLite storage on a supported local or corporate persistent volume. Keep the
backend and frontend as separate project roots.

From a fresh authorized checkout, install exactly from the committed locks:

```bash
cd backend
python -m pip install --require-hashes -r requirements.lock
cd ../frontend
npm ci
```

`requirements.txt` remains for publisher discovery. Use `requirements.lock` for
the backend install and `npm ci` for the frontend install. The corporate
publishability guard checks the two roots, lock files, frontend lock-to-manifest
alignment, FastAPI entrypoint, readiness behavior, proxy identity boundary, and
the Settings-owned production environment contract:

```bash
python scripts/corporate_publishability_guard.py
```

## Production configuration and secret boundary

Start from these examples and replace every marked value through the deployment
platform's configuration and secret store:

- `deploy/backend.env.production.example`
- `deploy/frontend.env.production.example`

The examples contain no usable credentials, employee identities, release ID,
signing key, or production data location. Unresolved operator placeholders fail
the production Settings guard. Never commit a populated environment file,
secret-manager export, token, or database dump.

The authoritative key list is `PRODUCTION_REQUIRED_ENV` in
`backend/app/core/config.py`; preflight and the publishability guard use this
contract rather than maintaining separate required-key lists.

The backend runtime must explicitly supply:

- `ENVIRONMENT=production`, `PORT`, explicit HTTPS `BACKEND_CORS_ORIGINS`, and
  explicit `ALLOWED_HOSTS` hostnames.
- `IDENTITY_MODE=trusted_proxy` and
  `TRUSTED_PROXY_USER_HEADER=X-Authenticated-User`. The ingress must strip any
  client-supplied copy, authenticate the request, then inject the trusted value.
  Browser code must not set that proxy identity header.
- Absolute file-backed SQLite `DATABASE_URL` and `CONFIG_DATABASE_URL` values,
  plus `TENANT_STORAGE_ROOT`. SQLite is the supported persistence contract for
  this release.
- `DEFAULT_USER_ID`, `CONTROL_PLANE_ADMIN_USER_IDS`, and `SYSTEM_ROOT_USER_IDS`
  supplied by the operator. Keep the control-plane administrator and reserved
  System Root identity planes explicit and separate.
- `CONTROL_PLANE_BOOTSTRAP_ENABLED=false` and an empty
  `CONTROL_PLANE_BOOTSTRAP_USER_ID` in production.
- `PUBLIC_READONLY_ENABLED=false`,
  `ALLOW_PUBLIC_READONLY_IN_PRODUCTION=false`, an empty `AUTO_ADMIN_USER_IDS`,
  and `ALLOW_AUTO_ADMIN_IN_PRODUCTION=false` unless a separate reviewed policy
  explicitly changes them.
- `SCHEDULE_PREVIEW_SIGNING_KEY`, injected from a secret manager as a unique
  value of at least 32 characters. Do not expose it to the frontend.
- `PV1_RELEASE_CANDIDATE_SHA` and `PV1_RELEASE_ID` for the committed candidate.

The frontend build receives `VITE_API_BASE_URL` for the separately published
backend origin and `VITE_IDENTITY_MODE=trusted_proxy`. A blank API base is valid
only when corporate ingress intentionally supplies same-origin `/api` routing.
Frontend configuration is public build input; it must never contain signing
keys or other secrets.

Production schema changes are operator-managed by default:

```dotenv
AUTO_MIGRATE_ON_STARTUP=false
ALLOW_AUTO_MIGRATE_IN_PRODUCTION=false
```

Automatic production startup schema changes require both values to be explicitly
set to `true`. Settings then reports `automatic`; otherwise it reports
`operator_managed`. Setting the first value to `true` without the second is an
unsafe configuration and fails the guard.
The application startup hook creates missing config tables and upgrades the
configured `DATABASE_URL`; it does not iterate every registered tenant
database. Use the explicit `apply-upgrade` operation below for the complete
config/default/tenant inventory.

## Persistent storage and permissions

Provision distinct persistent locations for the default database, config
database, tenant files, and backups. The paths in the examples are markers, not
real company paths. The service account needs read/write access to its SQLite
files and parent directories so SQLite can create and update `-wal` and `-shm`
sidecars. Restrict data, backup, and recovery roots to the service/operator
account; the lifecycle tool requires a POSIX backup root with mode `0700` and
creates snapshot and restore files with mode `0600`.

For a new POSIX deployment volume, provision the roots before startup and keep a
restrictive umask for processes that create SQLite files:

```bash
umask 077
install -d -m 0700 "$SYSGRID_DATA_ROOT" "$SYSGRID_TENANT_ROOT" \
  "$SYSGRID_BACKUP_ROOT" "$SYSGRID_RECOVERY_ROOT"
```

The app must not write production data into the checkout, frontend project, or a
temporary directory. Keep backup snapshots on persistent storage separate from
the live database files. This release supports file-backed SQLite only; it
does not define PostgreSQL or cloud-database durability guarantees.

## Qualification and rehearsal sequence

Run these commands from the repository root after deterministic installation,
with production-safe configuration injected by the platform. Use the target
candidate's trusted release identity. Keep the service stopped or in the
approved no-write maintenance state during a planned schema upgrade.

The production preflight proves source, configuration, and deployment
readiness. `scripts/verify-app.sh`, enforced by Application CI, remains the
canonical release-critical application gate. The lifecycle qualification and
rehearsal prove source-side snapshot, restore, migration, and readiness recovery;
real company-domain and pilot evidence must be collected separately.

1. Run the source/configuration/deployment readiness preflight:

   ```bash
   python scripts/production-preflight.py --json
   ```

   The preflight evaluates `Settings.production_guard_errors()` and emits only
   statuses and error counts. It runs frontend typecheck/build/contracts/unit
   checks and an explicit bounded backend deployment suite for production
   startup policy and migration compatibility. Its backend harness isolates
   test databases from configured persistent data; it does not run the whole
   backend suite or replace the canonical application gate.

2. Run the canonical source-side lifecycle. The backup root must already be
   provisioned with mode `0700`:

   ```bash
   python scripts/production-lifecycle.py qualify \
     --backup-root /path/to/restricted/sysgrid-backups \
     --report /path/to/restricted/evidence/qualification.json
   ```

   It checks runtime prerequisites and corporate publishability, validates the
   production Settings guard, audits the tenant registry, captures WAL-aware
   logical fingerprints, creates an online transaction-consistent snapshot,
   restores it into an isolated temporary root, verifies hashes and SQLite
   integrity, rehearses config `create_all` and Alembic upgrades on restored
   copies, prepares a second isolated recovery restore, starts the exact local
   FastAPI target with synthetic production-safe settings, probes health and
   readiness, then compares live-source logical fingerprints again. Temporary
   drill roots are removed after the run. The approved snapshot remains in the
   selected backup root.

   The JSON report contains operation/snapshot identifiers, candidate identity,
   step statuses, and counts. It omits database URLs, absolute data paths,
   tenant names, credentials, and environment contents. A failing or
   unverifiable step returns nonzero.

3. Run the repeatable fresh-checkout rehearsal on disposable synthetic data:

   ```bash
   python scripts/rehearse-production-lifecycle.py
   ```

   This repeats the lifecycle, checks source invariance and cleanup, injects an
   unsafe proxy configuration, and tampers with restore material. It uses no
   company credentials or live data. Its local Uvicorn startup and readiness
   result is source qualification only.

## Applying a rehearsed upgrade

After qualification identifies the approved snapshot, stop application writes
and attest that the app is stopped. Keep production startup migration flags
`false`; the operator command below independently rechecks the snapshot's
candidate identity, database inventory, checksums, SQLite integrity, and
WAL-aware logical fingerprints against the current live files. It then repeats
the config and tenant migration rehearsal on isolated copies immediately before
applying schema changes.

```bash
python scripts/production_data_guard.py apply-upgrade \
  --snapshot /path/to/restricted/sysgrid-backups/snapshot-... \
  --maintenance-token APP-STOPPED \
  --upgrade-token APPLY-REHEARSED-PRODUCTION-UPGRADE
```

This explicit operation uses SQLAlchemy `create_all` for the config database
and `alembic upgrade head` once for each distinct default/tenant SQLite file.
It does not restore or overwrite any database. It refuses a stale snapshot,
changed source data, mismatched candidate identity, missing tenant database,
invalid token, or automatic-startup migration policy. A nonzero result after
mutation began means schema work may be partial: keep the service stopped and
use the approved snapshot recovery procedure below if data/schema recovery is
required. The command never runs a down-migration.

## Publish, start, and readiness

Publish the backend from `backend/` with the platform's supported FastAPI
publisher. Where it accepts a custom install command, use:

```bash
python -m pip install --require-hashes -r requirements.lock
```

Set the platform application target to `app.main:app`. Its process supervisor
starts the backend with the platform-provided port; the equivalent direct
command is:

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

Publish the frontend independently from `frontend/`:

```bash
npm ci
npm run build
```

Publish `frontend/dist/` through the corporate Node/React static output
contract. Set `VITE_API_BASE_URL` to the backend origin at frontend build time
when the projects are cross-origin.

After schema preparation and both publishes, start the service through the
corporate supervisor and gate traffic on:

- `GET /api/v1/health` — process health, expected HTTP 200.
- `GET /api/v1/readiness` — config DB, default DB, and production guard readiness,
  expected HTTP 200 with `status=ready`.

Probe the backend origin after start:

```bash
python scripts/production-lifecycle.py readiness \
  --base-url https://replace-with-published-backend.invalid
```

The command does not follow redirects. A 503, login/SSO redirect, invalid JSON,
or failed dependency gate is a nonzero readiness result; keep traffic disabled,
inspect the platform's protected logs and configuration, correct the cause, and
probe again. The probe report records status codes and result only, not the URL
or response body.

If startup needs to be retried, use the platform supervisor's normal restart
control. Startup with operator-managed schema policy is idempotent and does not
run schema mutation; readiness remains 503 until both SQLite files can be
opened and the production guard passes. Do not bypass a 503 by routing traffic.

## Rollback and recovery

Rollback has two separate choices:

1. Roll back the backend/frontend application versions through the corporate
   publisher when the existing data remains compatible.
2. If data recovery is needed, stop the service and prepare a new isolated data
   root from the approved pre-upgrade snapshot:

   ```bash
   python scripts/production_data_guard.py recover \
     --snapshot /path/to/restricted/sysgrid-backups/snapshot-... \
     --target-root /path/to/restricted/sysgrid-recovery/release-rollback
   ```

   Recovery verifies snapshot checksums and integrity, restores to an empty
   target, rewrites tenant database references only in the restored config copy,
   records a recovery completion marker, and audits the resulting registry. It
   refuses nonempty targets and never overwrites live files. Use the snapshot
   manifest's `config` and `default` logical roles to set the service's
   `CONFIG_DATABASE_URL` and `DATABASE_URL` to the isolated copies; registered
   tenant references point inside the new root. Validate the new root before
   changing platform configuration to use it.

There are no supported down-migrations and no in-place restore command. Keep
the original live files and approved snapshot intact until the recovered
application passes readiness and the operator accepts the recovery.

## Scope and evidence boundary

Source-side checks prove deterministic locks, safe configuration, corporate
publishability contracts, SQLite snapshot/restore behavior, config and Alembic
migration rehearsal, controlled startup, local health/readiness, and
WAL-aware live-source invariance. They do not prove a real company-domain
browser session, proxy header rewrite, SSO behavior, corporate platform publish,
or employee acceptance. Those remain later field evidence and are not claimed
by this BUILD.
