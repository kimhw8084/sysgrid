# P0 Asset write safety and company qualification

Asset forms previously submitted changed fields without a captured revision.
Six regressions on unchanged main reproduced a saved peer value being replaced
by a stale draft. Bulk preview and client-built undo also lacked a durable,
actor-bound command identity.

## Implementation

- Device revisions follow the existing Service/Monitoring ORM version pattern.
  Current form edits require a loaded revision; invalid supplied guards never
  become unconditional writes. Existing integrations may omit the guard, while
  ORM compare-and-write still protects overlapping server transactions.
- The migration adds the revision column without rebuilding the Devices parent
  table. SQLite triggers preserve revisions for legacy SQL inserts/updates.
  Existing children, historical values and timestamps remain intact. New durable
  Asset command history is independent of device lifetime; destructive schema
  downgrade is rejected.
- Current bulk workflows bind preview, actor, tenant, selection, payload and
  revisions. Permanent purge additionally binds the full dependency fingerprint,
  including values and unsampled rows. Dependency values are streamed in bounded
  batches and only their hashes are retained for the preview fingerprint.
- Writer acquisition rechecks authority. Domain edits, OS synchronization,
  bounded audits and command receipts commit together. A repeated operation
  identity replays its original result; changed payloads cannot reuse it.
- Undo uses server-captured values and post-write guards. It preserves untouched
  fields and raw OS values, rejects peer changes, is idempotent, and supports
  recovery of the unpurged part of a prior selection. Structurally changed OS
  projections do not advertise unsafe compensation. Recovery state is bounded.
- Guarded bulk edits synchronize OS projections only for OS-related changes;
  single-record saves retain the existing audited OS repair behavior. Hostname create
  and rename checks acquire the SQLite writer before checking competing names.
  Restore and bulk rename validate case-insensitive conflicts before mutation.
- The active Asset route is the golden workspace. Its form, bulk and recovery
  paths are qualified here; gated legacy table editors are not promoted.

## Offline company evidence

Backend readiness identifies loaded source and the production/identity mode.
Production frontend builds publish a source fingerprint. The company probe
compares them against the exact clean checkout, verifies the no-change patch,
checks production configuration/storage/operations, and rehearses recovery only
on isolated synthetic data. It does not install dependencies or contact public
services. HTTPS requests are limited to explicit company origins, without
redirects or proxy discovery.

Detailed evidence stays inside the company in one verified ZIP. Only the
50-character checksum-protected summary is transcribed. Automatic checks,
authenticated-browser observations, human attestations and unverified gates are
distinct. The probe never grants production acceptance. Actual gateway/roles,
volume restart/recovery, scheduler alerts, included providers, target capacity,
desktop accessibility and the authentic pilot retain their field requirements.

## Required qualification

Retain the original negative cases and all intermediate failures. Run focused
Asset revision/command/migration tests, the existing authorization/lifecycle/import
suites, all frontend gates, both-theme native browser save/conflict/response-loss/
undo cases, and the existing required PR/main gates. Preserve graphics, Report/Map
behavior, configured values and top-right notifications. No assertion, retry or
timeout allowance is weakened. Rehearse migration on isolated copies of native
data and verify every pre-existing column/value before local rollout.

Lesson: a valid save needs both a captured client revision and atomic server
comparison; safe retries and undo need server-owned durable state.

Next rule: qualify stale drafts, overlapping writers, lost responses, repeated
undo and changed dependencies together. Synthetic or manually transcribed proof
must retain its scope and must not be promoted into unobserved company acceptance.
