#!/usr/bin/env python3
"""Generate human-readable pattern specification from canonical data/patterns.json.

--check verifies a checked-in doc without mutating it.
"""
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/patterns.json'
DOC=ROOT/'source_spec/02_14_COMPLETE_PATTERN_CONTRACTS_NONFINAL.md'
GROUPS=(('select','MUST choose / contextual decision rules'),('avoid','MUST NOT / anti-patterns'),('states','States to consider where applicable'),('accept','Candidate acceptance obligations'),('probes','Observable independent probes'),('escalate','Escalate only the affected decision when'))

def render():
    data=json.loads(SRC.read_text(encoding='utf-8'))
    pats=data['patterns']
    if len(pats)!=14 or {p['id'] for p in pats}!={f'P{i:02d}' for i in range(1,15)}:raise ValueError('Catalog ID mismatch')
    output=['# Golden Universal UI/UX — Fourteen Pattern Contracts','',
        '**GENERATED DOCUMENT — DO NOT EDIT DIRECTLY.** Source of truth: `data/patterns.json`. Regenerate using `python3 devtools/render_patterns.py`. All 14 remain non-final candidates and NOT_RUN.','',
        'These pattern IDs are not changes to SysGrid Constitution v0.2.1. Project-approved profiles govern visual tokens, components, density and user preferences.','']
    for p in pats:
        output += [f"## {p['id']} — {p['family']}",'',f"**Intent:** {p['intent']}",'']
        for key,title in GROUPS:
            output += [f'### {title}','']
            output.extend('- '+v for v in p[key]);output.append('')
        output += ['**Evidence:** NOT_RUN. An agent MUST NOT infer application test PASS from this proposed specification.','']
    return '\n'.join(output).rstrip()+'\n'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');a=parser.parse_args()
    candidate=render()
    if a.check:
        if not DOC.is_file() or DOC.read_text(encoding='utf-8')!=candidate:
            print('DRIFT: generated patterns doc differs from canonical JSON',file=sys.stderr);return 1
        print('Canonical catalog and generated document match');return 0
    DOC.write_text(candidate,encoding='utf-8')
    print('Generated',DOC)
    return 0
if __name__=='__main__':sys.exit(main())
