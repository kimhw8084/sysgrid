# SysGrid Infrastructure

SysGrid is a multi-tenant infrastructure operations platform. This guide covers the supported development startup, disposable seeding, forwarded/remote environments, health checks, recovery, and bug reporting.

## 1. Prerequisites

- Python 3.11+
- Node.js 20+
- `curl`, `lsof`, and Bash
- Backend virtual environment at `backend/venv`
- Frontend dependencies at `frontend/node_modules`

First-time dependency setup:

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt

cd ../frontend
npm install
cd ..
```

Do not store credentials or company access tokens in committed `.env` files.

## 2. Fastest local start

```bash
./scripts/start-local.sh
```

Default browser endpoints:

```text
Frontend: http://127.0.0.1:5173
API:      http://127.0.0.1:8000
Health:   http://127.0.0.1:8000/api/v1/health
```

The local workflow is intentionally disposable. Every full start:

1. stops listeners owned by the configured local ports;
2. recreates the Local Demo config and tenant databases;
3. seeds the selected admin user and optional domain data;
4. runs preflight;
5. starts the backend;
6. verifies health, the browser-visible `Host`, and CORS;
7. starts Vite only after the backend contract passes.

It does not touch production databases.

## 3. VS Code forwarded ports or company development URLs

Use the exact origins shown by the environment’s forwarded-port UI:

```bash
./scripts/start-local.sh \
  --api-base-url "http://8000.vscode.company.example/" \
  --frontend-origin "http://5173.vscode.company.example/" \
  --user-id-env-var AccessKey \
  --skip-typecheck
```

Trailing slashes are normalized automatically.

`start-local.sh` derives and configures:

- `ALLOWED_HOSTS` from the API hostname;
- `BACKEND_CORS_ORIGINS` from the frontend origin;
- `VITE_API_BASE_URL`;
- local health and browser-visible health URLs;
- the configured identity environment variable.

The API base must be an origin only:

```text
Correct:   https://api.example.com
Incorrect: https://api.example.com/api/v1
```

An HTTPS frontend cannot call an HTTP API. Use the exact HTTPS API origin when the frontend is HTTPS.

Inspect the resolved contract without resetting databases or starting services:

```bash
./scripts/start-local.sh \
  --api-base-url "http://8000.vscode.company.example/" \
  --frontend-origin "http://5173.vscode.company.example/" \
  --user-id-env-var AccessKey \
  --skip-typecheck \
  --print-runtime-config
```

## 4. Identity and admin seeding

The default disposable admin user is `haewon.kim`.

Select another source-of-truth environment variable:

```bash
./scripts/start-local.sh \
  --user-id-env-var AccessKey
```

Pass the effective user explicitly when the environment does not export it:

```bash
./scripts/start-local.sh \
  --user-id-env-var AccessKey \
  --runtime-effective-user-id "person@example.com"
```

The effective runtime user is included in `AUTO_ADMIN_USER_IDS` for the disposable Local Demo seed.

## 5. Seed modes

Seed representative domain data:

```bash
./scripts/start-local.sh --seed-data
```

Create only the required tenant/admin/reference foundation:

```bash
./scripts/start-local.sh --no-seed-data
```

Direct seed command:

```bash
./backend/venv/bin/python seed.py \
  --tenant-name "Local Demo" \
  --tenant-db "tenants/local-demo/local_demo.db" \
  --admin-user "haewon.kim" \
  --seed-data
```

The local databases are:

```text
backend/config.local.db
backend/tenants/local-demo/local_demo.db
```

## 6. Health and origin verification

Backend health:

```bash
curl -i http://127.0.0.1:8000/api/v1/health
```

Simulate a forwarded browser host against the local backend:

```bash
curl -i \
  -H "Host: 8000.vscode.company.example" \
  -H "Origin: http://5173.vscode.company.example" \
  http://127.0.0.1:8000/api/v1/health
```

The result must be HTTP 200 and include the expected `Access-Control-Allow-Origin`.

Readiness:

```bash
curl -i http://127.0.0.1:8000/api/v1/readiness
```

## 7. Startup troubleshooting

### `400 Invalid host header`

Cause: the browser-visible API hostname was not accepted by `TrustedHostMiddleware`.

Fix: use `scripts/start-local.sh` with the actual `--api-base-url`. The script now adds the API hostname to `ALLOWED_HOSTS` automatically and proves it before Vite starts.

### Browser reports CORS or `Failed to fetch`

Check:

- `--frontend-origin` exactly matches the browser origin;
- frontend and API schemes are compatible;
- the API forwarded port is visible to the same audience;
- the health URL opens in the browser;
- no stale `SYSGRID_OVERRIDE_API_URL` remains.

### HTML or login page returned instead of JSON

The API port may require authentication, or the URL may point to a frontend/proxy fallback. Open `/api/v1/health` directly and complete the environment login.

### Wrong user or tenant

Use the bootstrap error window’s diagnostics. Confirm the effective user, selected tenant, and seed command. Clear only stale API overrides; do not bypass bootstrap validation.

## 8. Bootstrap failure window and Buganizer

The bootstrap failure window classifies:

- invalid trusted host;
- CORS/network failure;
- mixed content;
- loopback API mismatch;
- invalid API base;
- authentication redirect;
- wrong route;
- wrong content type;
- backend/tunnel unavailability;
- forbidden identity or tenant.

Available actions:

- Retry
- Open Health
- Copy Fix
- Copy Diagnostics
- Open Buganizer / Copy Bug Report
- Clear Overrides

Configure the company Buganizer/new-issue URL:

```bash
./scripts/start-local.sh \
  --buganizer-url "https://buganizer.example.com/issues/new"
```

or set:

```text
VITE_BUGANIZER_URL=https://buganizer.example.com/issues/new
```

SysGrid copies a sanitized report before opening Buganizer. Token-like query parameters, authorization values, API keys, and passwords are redacted. Review the copied report before submission.

## 9. Validation

Backend focused proof:

```bash
./backend/venv/bin/python -m pytest \
  scripts/tests/test_runtime_origin_config.py \
  backend/test_main.py
```

Frontend diagnostics proof:

```bash
cd frontend
npm run typecheck
npx vitest run \
  src/api/apiClient.test.ts \
  src/api/bootstrapDiagnostics.test.ts
npm run build
```

Full application gate:

```bash
./scripts/verify-app.sh
```

## 10. `sg` and `sgs`

Place exactly one control-room runner in:

```text
iCloud Drive/SysGrid-Control/Inbox
```

Start:

```bash
sg
```

Inspect:

```bash
sgs
```

The control plane recognizes the canonical artifact:

```text
SysGrid-Control/Outbox/UPLOAD_THIS_TO_CHATGPT.zip
```

Status output distinguishes running, stalled, failed, and successful states; reports the current stage and Git provenance; verifies ZIP size and SHA-256; and always prints the next operator action.

## 11. Production boundary

`start-local.sh` is for disposable development only. Production uses the
canonical operator lifecycle in [DEPLOYMENT.md](DEPLOYMENT.md): Settings-owned
configuration validation, committed dependency locks, isolated SQLite snapshot
and migration rehearsal, an explicit schema-upgrade gate, and health/readiness
checks. Corporate process supervision remains outside the repository. Synthetic
source qualification does not establish company-domain, proxy, SSO, or browser
field proof.

## Core engineering standards

- Durable collaborative saved views use the first-class workspace views API.
- Transient personal preferences remain separate from durable saved views.
- Backend seed data and API responses are schema validated.
- Domain-specific behavior must not be flattened into a generic CRUD surface.
- Routed proof is required for changes involving browser origin, host, identity, or persistence.
