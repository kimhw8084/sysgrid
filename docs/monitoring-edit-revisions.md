# Monitoring edit revisions

Monitoring list and save responses include `edit_revision`, an opaque, server-owned revision. Keep it with the record snapshot that supplied an edit form. Do not replace a draft's revision when background data refreshes.

To save conditionally, include that snapshot's revision in a `PUT /api/v1/monitoring/{id}` request:

```json
{
  "purpose": "Reviewed monitoring purpose",
  "expected_revision": "32-character revision from the original response"
}
```

The example revision is descriptive; use the actual lowercase hexadecimal value returned by the server. A successful change returns a new revision. A successful no-op retains the revision. The separate integer `version` continues to identify historical Monitoring revisions.

If `expected_revision` is supplied, malformed values receive HTTP 400 and stale values receive HTTP 409. Rejection preserves the committed record and creates no successful history/audit event. A missing record receives HTTP 404. The browser edit form always supplies its captured revision and retains its draft after a conflict. It also refuses to save an existing record whose revision is unavailable. Review the latest record before deliberately reapplying copied draft changes; never retry with an automatically refreshed revision.

Existing API integrations may continue to omit `expected_revision`. Such requests retain their unconditional update behavior. To protect an integration's read-modify-write cycle, adopt the conditional request above. Supplying `edit_revision` itself cannot set or rewind the server's revision.

The database revision is generated on mapped inserts/updates. ORM updates additionally compare the loaded revision in the UPDATE predicate, so a peer commit during a request cannot silently replace the newer row. SQLAlchemy Core updates also advance the revision. Direct SQL maintenance is outside this protocol and must not run as a concurrent application writer.

## Deployment and rollback

Migration `d4a7b2c8e1f0` extends `e39a28b5d0f2`. It backfills a distinct revision for each existing monitor, makes the column non-null, and preserves the integer history counter. Tests cover empty, populated and multi-batch backfills, child history/owners, constraints and downgrade preservation.

Use the existing production lifecycle procedure: stop application writers, verify the configuration and tenant database backups, migrate every tenant, then start the matching application version. Mixed old/new application binaries are not qualified: the old model cannot supply this required column when creating a monitor. For rollback, use the reviewed schema/application rollback plan or the verified matching database backup; do not start an older binary against this newer schema by assumption.

This change protects the individual Monitoring edit form and conditional PUT callers. It does not claim stale-draft protection for bulk editors, Undo, other entity forms, or external callers that omit the precondition. Full company deployment, supported-browser/state coverage and release acceptance remain separate gates.
