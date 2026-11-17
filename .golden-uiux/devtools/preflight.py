#!/usr/bin/env python3
"""Structural release preflight (not UI app, legal or client conformance)."""
from __future__ import annotations
import json,sys,re

def require(condition, message):
    if not condition: raise RuntimeError('PREFLIGHT_FAILED: '+str(message))
from pathlib import Path
root=Path(__file__).resolve().parents[1]
patterns=json.loads((root/'data/patterns.json').read_text())['patterns']
require(len(patterns)==14 and [p['id'] for p in patterns]==[f'P{i:02d}' for i in range(1,15)], '14 canonical pattern IDs in order')
require(all(p['verification_status']=='NOT_RUN' and p['approval_status']=='NON_FINAL_PROPOSAL' for p in patterns),'candidate proofs and approval statuses')
require((root/'source_spec/02_14_COMPLETE_PATTERN_CONTRACTS_NONFINAL.md').is_file(),'rendered pattern contract file')
sys.path.insert(0,str(root/'devtools'))
from render_patterns import render
require(render()==(root/'source_spec/02_14_COMPLETE_PATTERN_CONTRACTS_NONFINAL.md').read_text(),'canonical pattern rendering drift')
skills=sorted((root/'opencode_skills').glob('*/SKILL.md'))
require(len(skills)==9,'nine candidate skills')
for x in skills:
 t=x.read_text()
 require(t.startswith('---\n') and f'name: {x.parent.name}\n' in t and 'description:' in t, str(x)+' frontmatter')
 require('NOT_RUN' in t or 'PASS' in t, str(x)+' evidence disclaimer')
# Ensure original policy references are present; no SysGrid Constitution changes.
for name in ('00_MASTER_NONFINAL.md','01_P0_P1_CANONICAL_REPLACEMENTS_NONFINAL.md',
             '02_14_COMPLETE_PATTERN_CONTRACTS_NONFINAL.md','04_ADAPTER_CONTRACT_AND_EXAMPLES_NONFINAL.md',
             '05_QUALITY_GATES_NONFINAL.md','06_EVALUATION_PROTOCOL_NONFINAL.md',
             '07_SKILL_ROUTING_NONFINAL.md','08_REFERENCES_AND_LIMITS.md'):
 require((root/'source_spec'/name).is_file(),name+' required source document')
p=json.loads((root/'examples/sysgrid_profile_SOURCE_OBSERVED_NOT_APPROVED.json').read_text())
require(p['approval_status']=='PROPOSED','SysGrid profile must remain PROPOSED')
sys.path.insert(0,str(root))
from golden_uiux.core import canonical_hash
require(p['profile_digest']==canonical_hash(p),'SysGrid profile canonical digest')
require((root/'docs/SBOM.cdx.json').is_file(),'candidate SBOM exists')
sbom=json.loads((root/'docs/SBOM.cdx.json').read_text())
require(sbom['bomFormat']=='CycloneDX' and sbom['specVersion']=='1.6','candidate SBOM format')
require('UNPINNED' in (root/'docs/SBOM.cdx.json').read_text(),'honest unpinned dependency disclosure')
require(len(json.loads((root/'data/adversarial_paper_cases.json').read_text())['cases'])==24,'24 unexecuted adversarial paper cases')
release=json.loads((root/'data/release_identity.json').read_text())
from golden_uiux import __version__
require(release['version']==__version__,'release identity agrees with runtime version')
proof=json.loads((root/'data/proof_schema.json').read_text())
from golden_uiux.core import PROOF_REQUIRED_FIELDS
require(set(proof['required'])==set(PROOF_REQUIRED_FIELDS),'proof schema matches runtime required fields')
print(json.dumps({'status':'STRUCTURAL_PREFLIGHT_PASS_NOT_APPLICATION_QUALIFIED','patterns':14,'skills':9,'paper_cases':24,'client_tests':'NOT_RUN','sysgrid_app_tests':'NOT_RUN'}))
