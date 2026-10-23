# Guided workspace quality and legacy Network edits

An Asset Report could repeatedly replace the operator's selection through a parent/child effect loop. Existing demo Network records also contained values that the configured creation contract rejected. The Network editor inside Assets was a separate implementation with the wrong direction, unit, and payload definitions. Network table editing ignored unsuccessful HTTP responses and could partially save rows while reporting success.

## Resulting behavior

- Report selection has one owner. User choices and external selection updates no longer replay each other. Its nine sections remain available, with theme-aware panels, readable address columns, section navigation, and recorded timestamps rather than the current clock labeled as a synchronization time.
- Report and Map share a responsive topology renderer. Graph input is copied before simulation, traversal indexes adjacency once, link direction remains explicit, unrecognized historical directions do not invent arrows, and tooltip values are escaped. Map adds fit/zoom/focus controls and an equivalent keyboard-accessible asset list. Extra filters collapse on phones; clearing selections does not immediately restore an external seed.
- Asset, Network, Service, Monitoring, and Rack entry flows use concise, colored guidance. Section-card titles are visible headings. Asset identity fields come first; optional rack fit, lifecycle, and metadata stay accessible under a disclosure. Validation retains the draft and focuses the first invalid control, including controls inside disclosures. Errors appear on submission and clear during correction, avoiding layout shifts while moving between Asset fields.
- Assets and Network use the same connection editor and request contract. Existing retired choices remain identifiable. New entries use configured defaults, including definitions that arrive after a form opens. Edits submit changed fields, preserving untouched historical values, nullable fields, and date/time precision.
- Network metadata table edits use one bounded transaction for up to 200 changed rows. All identities, revisions, fields, and configured values are validated before writing. Row changes and their audits commit together. Invalid or stale batches preserve the editor draft. The table no longer offers a paused/active toggle that was never persisted.
- Connection responses expose a content revision. The current UI submits its captured revision; stale single edits return 409. Single-update clients that omit a revision retain backward compatibility. The database update itself also compares business fields to close the read/write race. Lost-response retries are not automatic.
- Rack configuration rejects invalid capacities and site identifiers before mutation. Zero rack/PDU capacity remains zero when listed or edited. Rack creation and its audit commit together. Site/Rack forms support labels, keyboard submission, browser numeric constraints, and responsive widths. Group creation has a clear action name and blocks empty or duplicate pending submissions.
- New demo connections use registered link types, farms, cable types, and valid directions. Full seeding validates every generated connection against the write schema and configuration and rejects duplicate physical endpoints. Historical tenant records are preserved; this change does not rewrite old categories or endpoints.

## Verification and acceptance rule

The canonical backend selection includes the legacy Network and atomic table-edit suites. Browser regression coverage checks stable Report selection, all Report sections, keyboard Map interaction, guided Asset creation, unchanged timestamp preservation, rejected Network drafts, and atomic table save behavior. Both visual themes and phone/desktop widths are exercised. Existing field-label, pending-save, and dirty-close assertions remain in place.

Run the unchanged protected Application CI gates, with one browser worker, zero retries, the existing timeouts, and an exact disjoint union of the three normal browser shards. Review original provider archives before integration. A local render audit alone is not acceptance evidence for saves, concurrent edits, or company deployment.

Lesson: populated historical records and their edit requests must be part of qualification. A successful fresh create or an attractive screenshot cannot establish that an existing record is editable.

Next rule: whenever a configurable field or editor owner changes, verify a fresh valid create, an unrelated edit of a retired value, a rejected changed value with its draft preserved, and the exact persisted result. Preserve original failures and distinguish product corrections from test-harness corrections.
