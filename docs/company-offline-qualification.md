# Company qualification without evidence egress

Use the release-specific, SHA-bound launcher supplied after source review. Run it
with the deployed backend's Python environment and production configuration.
No dependencies are installed, no external service is contacted, and no source,
credential, live record or database is uploaded. Calls go only to explicitly
entered company HTTPS origins; authentication redirects are never followed.

The probe verifies clean main and exact head, its own SHA and critical source
hashes. It checks/applies a hash-bound empty patch and verifies source afterwards.
The Git commit has 40 hexadecimal characters. The existing production release
identity has 64: it must match `PV1_RELEASE_CANDIDATE_SHA` in the deployed backend
environment. Loaded backend and published frontend source hashes independently
bind the running code to the verified checkout; the two identities are not interchangeable.
It then checks production configuration, deployed frontend/backend source identity,
storage outside the checkout, an isolated scratch write/fsync/readback, bounded
read-only database/operations checks, and the existing isolated recovery rehearsal.
The rehearsal is separate from recovery of the deployed volume.

Detailed results remain in a new directory outside the checkout. It contains one
verified `UPLOAD_THIS_TO_CHATGPT.zip`, a readable private `report.json`, and
`SUMMARY.txt`. Keep the ZIP inside the company. Type only the **50-character SG1
summary** back to the control room. It contains commit/probe prefixes, a status
vector, a report digest prefix and a copy-error checksum; it contains no URLs,
identities, database values or secrets. It is an operator-transcribed report,
not an independently inspected archive or an automatic production certificate.

Status order: **S C F A D O R I V J P L U H**.

| Code | Observation |
| --- | --- |
| S | Exact source, patch and runner checks |
| C | Production configuration |
| F | Published frontend source and identity mode |
| A | Ready production backend, expected release and loaded source |
| D | Storage location and scratch durability checks |
| O | Read-only operational/database health inspection |
| R | Synthetic isolated recovery rehearsal |
| I | Actual identity, tenant, role and gateway-boundary observations |
| V | Actual restart/redeploy and isolated volume recovery within agreed RPO/RTO |
| J | Scheduler, backup and delivered-failure-alert observations |
| P | Included live providers, or explicitly registry-only scope |
| L | Representative target capacity and sustained-session measurements |
| U | Eight desktop workspaces, themes, keyboard, zoom and assistive technology |
| H | Authentic engineer pilot and recorded participant count |

**P** means an automated check passed; **F** failed; **U** remains unverified;
**A** records a human attestation; **N** applies only when live providers are
outside the declared release scope. An unknown answer never becomes a pass.
Exit 0 means ready for control-room field review, 1 means failed checks, 2 means
source/output/interpreter rejection, and 3 means incomplete observations.

The interactive attestation option asks about completed observations only. Record
actual users with different roles, an approved test record surviving redeployment,
a recovered isolated backup, a delivered scheduler failure alert, measured capacity
at the agreed user/estate size, and real engineers' task outcomes. Do not use
synthetic headers, a readiness response or an isolated rehearsal to answer those
questions. The control room reviews the returned status and identifies the next
specific failed or unverified gate; remaining detailed evidence stays internal.

If the gateway requires a browser session, the probe reports the frontend/backend
identity check as unverified instead of following SSO redirects. In interactive
attestation mode it can compare the public source hashes, release SHA and identity
mode observed in your authenticated company browser. Those results remain marked
as browser observations, distinct from automatic checks. Cookies and tokens are
never requested.
