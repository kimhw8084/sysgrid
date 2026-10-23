# Company qualification and release decision

The released V1 scope is Home, Assets, Monitoring, Services, Network, Racks,
Audit Logs and Settings/Access. Preview modules keep their existing gates.
Local checks and synthetic capacity measurements do not grant production
acceptance. Record the exact deployed commit and frontend build identity before
collecting field evidence; retain the original failed observations as well.

The supported product experience is desktop-only. Qualify desktop window resizing
and short laptop screens; phone and tablet product design are outside release
scope. Accessibility zoom and keyboard operation remain desktop requirements.

## Inputs the deployment owner supplies

Use the guided `workstation-up.sh` configuration for a cloud terminal workspace,
or the corporate publishing contract in [DEPLOYMENT.md](../DEPLOYMENT.md).
[PAAS-START.md](../PAAS-START.md) covers the single-app PaaS alternative.
The required field facts are the actual HTTPS origin, a persistent storage root
outside the checkout, the identity mode and variable/header name, the first
administrator identity and the separate reserved System Root identity. Keep
credentials and signing-key values in the platform secret store.

For shared hosting the gateway must authenticate and replace the trusted user
header on every request. Environment identity serves one named user per backend
process. Neither a local header simulation nor a green readiness response proves
the real gateway boundary.

## Evidence collected on the company target

| Gate | Required observation |
| --- | --- |
| Publish and identity | Real HTTPS browser reaches the exact candidate; sign-in, sign-out and expired identity behave as intended. Direct backend access and spoofed browser identity cannot bypass the gateway. |
| Roles and tenants | Two real users with different roles see only assigned tenants. A viewer cannot mutate. Removing membership blocks later requests and sync access. |
| Collaboration | Concurrent operators change the same representative record and independent records. Record the supported conflict behavior; never treat silent lost edits as acceptance. |
| Eight workspaces | Perform representative create/edit/search/filter/detail/export and archive/restore workflows where supported, using actual tasks and approved test records. Check audit actor and target against the operation. |
| Visuals and interaction | Both themes, normal and short laptop viewports, keyboard navigation, 200% zoom, supported browsers and actual assistive technology. Include errors, empty states, pending saves and recovery. Notifications remain at the viewport top-right. |
| Durability | Write an approved test record, restart/redeploy the same candidate without replacing its volume, and verify it remains. Rehearse recovery on isolated copies with agreed RPO/RTO. |
| Capacity | Repeat representative work on the company host. Record concurrent users, estate size, workload mix, observation duration, p95 latency, failures and memory/resource trends. A local synthetic envelope is only a comparison point. |
| Operations | Platform scheduler runs storage/operation health checks and backups. Deliberately exercise one failure and prove the alert reaches the responsible operator. Preserve run reports and recovery evidence. |
| Real providers | Company-selected operational adapters and credential custody/rotation are verified before accepting their workflows. Simulation remains visibly labeled. |
| Human pilot | Authentic engineers execute representative tasks, record defects and outcomes, and explicitly accept or reject the candidate. Automated or simulated users cannot supply this verdict. |

The evidence record should contain gate ID, candidate/build identity, UTC time,
environment class, user role (not credentials), task, expected and actual result,
artifact digest, defect link and reviewer verdict. Keep sensitive screenshots,
record values and logs in approved restricted storage.

## Scheduled operational checks

The read-only `production-operations.py` job inventories all registered live
SQLite files, verifies bounded integrity/schema checks, reports free space,
database/WAL sizes, unresolved attempts, audit record counts, pending outbox
records and expired command records. An explicit unknown outcome requires
operator review; live attempts are reported without being declared stuck, and
elapsed time never grants an automatic retry. The platform scheduler
must retain reports, prevent overlapping invocations, alert on nonzero exits or
missing runs, and enforce its own execution deadline. Its cadence and disk
floor must reflect the actual host and growth rate.

This job preserves domain data, audit history, backups and command deduplication
records. Expired command timestamps alone do not authorize deleting replay
protection. Backup retention and any domain/history purge need a separately
reviewed retention policy and a proven recovery path. Automatic destructive
janitoring is not qualified by the inspection job.

The existing production lifecycle provides snapshot, restore, migration and
isolated recovery rehearsal. A successful synthetic rehearsal proves that source
contract; the company operator must still demonstrate scheduler delivery,
restricted backup storage and recovery against the deployed environment.

## Decision

Maintain separate verdicts for source checks, rendered browser qualification,
synthetic load, company deployment and the human pilot. Failed, incomplete or
unverifiable required gates keep production acceptance false. Never transfer a
verdict from a previous commit to changed source without reviewing the delta and
running the applicable checks.
