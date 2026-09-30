# Start SysGrid on a work PaaS

This path starts the **desktop UI and FastAPI together as one web app**, at one
HTTPS address. It works from a checkout of `main`. The repository contains the
Dockerfile, dependency locks, first-install database setup, and start command.
The PaaS provides the HTTPS address, persistent storage, process supervision,
and company sign-in. You do not need to invent database URLs, CORS settings,
build paths, or a signing key.

## Before clicking Deploy

Collect these four values from your work PaaS:

| Value | What it means | Example only |
| --- | --- | --- |
| Public HTTPS address | The URL teammates will open | `https://sysgrid.company.example` |
| Persistent disk | A volume that remains after redeploying the app | Mounted at `/data` |
| First admin ID | The exact ID the company gateway sends for you | `haewon.kim` |
| System Root ID | A separate restricted company identity | `sysgrid-system-root` |

The gateway must authenticate each request and send its verified user ID to the
app as `X-Authenticated-User`. It must discard any such header supplied by the
browser. Restrict direct access to the app so requests pass through that gateway.
If your gateway uses another header, set `SYSGRID_IDENTITY_HEADER` to its name.
This is the one company integration the repository cannot guess.

Enable backups or snapshots for the persistent volume before storing team data.

## First deployment

1. In your PaaS, create **one web app** from the SysGrid Git repository's
   `main` branch. Select the repository-root `Dockerfile` as the build method.
   Use one running instance; this release uses file-backed SQLite.
2. Attach a **persistent volume** to that app and choose its mount path, for
   example `/data`. The application must be able to write there. This is where
   configuration, databases, tenant data, and the signing secret live. Keep the
   volume when updating or rebuilding the app.
3. Add these environment variables in the PaaS app settings. Replace every
   example with your actual values:

   ```dotenv
   SYSGRID_DATA_ROOT=/data
   SYSGRID_PUBLIC_URL=https://sysgrid.company.example
   SYSGRID_ADMIN_ID=haewon.kim
   SYSGRID_SYSTEM_ROOT_ID=sysgrid-system-root
   ```

   The data root is the **mount path inside the running app**, not a path on
   your laptop. The public URL is the app's HTTPS origin with no path or
   trailing slash. The two IDs must be different.
4. Set the PaaS start command to `python scripts/paas.py serve` if it asks for
   one. The Dockerfile already supplies this command, so leave the field blank
   if the PaaS uses the Dockerfile command. Let the PaaS build and start the app.
5. Open `https://YOUR-ACTUAL-APP-HOST/api/v1/readiness`. A successful start
   returns HTTP 200 and `"status":"ready"`. Then open the public app URL and
   sign in as the configured first admin. The `SysGrid` tenant is created
   automatically on the **first empty-volume start**.

On first start, the app saves restricted configuration on the persistent
volume, creates its databases, runs their initial migrations, creates one
tenant, and grants the first admin access. On later starts it checks the
existing database schemas and leaves the records in place. It refuses to
start against a partial or older schema; the operator must use the reviewed
upgrade procedure in [DEPLOYMENT.md](DEPLOYMENT.md).

## Check that updates keep data

Create one test asset in the app. Redeploy the **same commit** while keeping
the persistent volume attached. Open the app again and confirm that asset is
still present. Then invite a second user in Settings and check their assigned
tenant role.

For planned version upgrades after team data exists, follow the backup,
rehearsal, and explicit migration steps in [DEPLOYMENT.md](DEPLOYMENT.md).
The app does not change existing schemas at ordinary startup.

## If your PaaS does not build Dockerfiles

Use one app with Python 3.12+ and Node 22.13+ (Node 22 LTS). From the
repository root, set its **build command** to `python3 scripts/paas.py build`
and its **start command** to `python3 scripts/paas.py serve`. Use the same
persistent volume and four environment values above. The build command
installs the committed Python/npm locks and builds the UI; the start command
serves the API and UI at one URL.
