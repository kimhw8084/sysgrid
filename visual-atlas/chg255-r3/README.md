# CHG-255 R3 targeted Settings responsive package

This package is bound to candidate `ecad9edd993c4022f4716e1e4099bc2dad29c4a0`, whose direct parent is the exact R2 candidate `31ee72386876b2ef877a72236c44d7e1895c2ed2`. It contains only the R2-before Settings profiles and the R3 Settings/Metadata responsive captures and proof reports.

`before-r2/` contains the exact R2 390×844 failure image from carrier commit `70101ea3bfa81d73f4285629ed418a80f9c7dc76` and 390×600/200% captures made from the detached exact R2 candidate. `after-r3/` contains action-closure profile captures, each authorized tab, Metadata desktop, and the intentional negative clipped-action fixture.

The action-closure JSON records geometry, full label containment, semantic/enabled status, pointer hit-testing, keyboard/touch reachability, and body/document horizontal overflow. The negative control is rejected specifically for clipping and incomplete label containment. `reports/test-results.json` records the qualification result, including the full-suite Monitoring failure and isolated pass.
