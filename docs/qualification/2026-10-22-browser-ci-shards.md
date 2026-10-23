# Browser qualification within the existing CI budget

The resulting-main Application CI runs `39781085656` and `39788965403`
were cancelled at the existing 45-minute job limit. Their serial browser
stages recorded 414 and 482 passing cases respectively, with no observed
failed cases and no final HTML report. Both runs remain incomplete and
unaccepted. Variable hosted Chromium installation consumed approximately
12 and 7 minutes of those jobs. The other qualification stages passed.

Run the unchanged normal browser selection as three Playwright shards on
separate hosted runners. Each runner owns its own backend, frontend and
temporary databases, still uses one browser worker and zero retries, and
retains the existing test and job timeouts. Local `verify-app.sh` remains
unsharded unless `SYSGRID_VERIFY_SHARD` explicitly selects `1/3`, `2/3` or
`3/3` with `--stage normal-v1`.

Each shard records the complete unfiltered test selection, its actual
JSON results, original HTML report, runtime logs and SHA-bound identity.
The existing required `qualification (normal-v1)` context now verifies
the three original reports: exact run/candidate/trigger identity, equal
full selections, disjoint execution, complete coverage, first-attempt
passes, no global errors and only the two existing preview-related skips.
The final `required` check also requires this union gate to succeed.
Missing artifacts, incomplete runners, overlapping or omitted tests,
unexpected skips, retries and stale evidence fail qualification.

The branch protection contexts and application code are unchanged.
Repository qualification and company deployment acceptance remain
separate; this change does not certify hosting identity, persistent
storage, recovery objectives, operations or the human pilot.
