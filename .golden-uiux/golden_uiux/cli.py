"""CLI with read-only design tools and explicitly gated browser operations."""
import argparse
import json
import sys
from pathlib import Path
from . import __version__
from .core import (patterns_index,get_pattern,route_task,check_plan,proof_audit,
                   validate_profile,canonical_hash,geometry_compare,catalog_digest)


def load_json(path):
    if not path:
        return None
    p = Path(path)
    if not p.is_file() or p.stat().st_size > 3_000_000:
        raise ValueError('JSON input must be an existing file under 3 MB')
    return json.loads(p.read_text(encoding='utf-8'))


def create_parser():
    parser = argparse.ArgumentParser(prog='golden-uiux', description='Offline rule catalog and structural evidence tools; never grants engineering permission')
    parser.add_argument('--version', action='version', version=__version__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('patterns', help='List 14 canonical pattern summaries')
    pat = sub.add_parser('pattern', help='Read a single pattern')
    pat.add_argument('id')
    route = sub.add_parser('route', help='Route a UI task from structured product intent and component needs')
    route.add_argument('text')
    route.add_argument('--profile', help='Approved project profile JSON')
    route.add_argument('--intent-spec', required=False, help='JSON with intent_id, workflow_steps, component_needs, constraints and optional scope_mode')
    route.add_argument('--ids', nargs='+', help='Requested pattern IDs; any pattern unsupported by the structured intent is rejected')
    workflow = sub.add_parser('design-workflow', help='Prepare a source-bound design comparison and local implementation context; does not authenticate live delivery')
    workflow.add_argument('request_json', help='Request with product observations, two existing alternatives, criteria and structured intent')
    workflow.add_argument('--output', required=True, help='New output directory; existing destinations are refused')
    workflow.add_argument('--source-root', required=True, help='Root directory containing the exact context files named in the request')
    session = sub.add_parser('design-session', help='Prepare or close a source-bound agent implementation workflow')
    session_sub = session.add_subparsers(dest='session_action', required=True)
    session_start = session_sub.add_parser('start', help='Copy bound starter files into isolated baseline/candidate folders and write an actionable agent task')
    session_start.add_argument('request_json')
    session_start.add_argument('--source-root', required=True)
    session_start.add_argument('--output', required=True)
    session_finish = session_sub.add_parser('finish', help='Hash the implementation diff and execute the six-gate evidence dispatcher')
    session_finish.add_argument('session_dir')
    session_finish.add_argument('--submission', required=True)
    session_finish.add_argument('--gate-request', help='Optional populated gate request, relative to the session directory')
    prof = sub.add_parser('profile', help='Validate a project profile without claiming external approval')
    prof.add_argument('json_path')
    prof.add_argument('--digest-only', action='store_true', help='Compute canonical digest excluding self-reference')
    pl = sub.add_parser('plan', help='Check structural completeness of a design plan')
    pl.add_argument('json_path')
    pl.add_argument('--profile')
    proof = sub.add_parser('proofs', help='Audit proof metadata while refusing to self-certify release')
    proof.add_argument('json_path')
    proof.add_argument('--source-revision')
    geo = sub.add_parser('geometry', help='Compare two numeric geometry snapshots')
    geo.add_argument('before')
    geo.add_argument('after')
    browser = sub.add_parser('browser', help='Browser probes on an authorized disposable nonproduction app; NOT inherently read-only')
    browser.add_argument('spec', help='Browser audit JSON specification')
    browser.add_argument('--output', required=True, help='Existing or new evidence output directory')
    browser.add_argument('--allow-remote', action='store_true', help='Explicitly allow remote/non-loopback origins; only on authorized disposable test systems')
    browser.add_argument('--allow-interactions', action='store_true', help='Enable click/fill/press actions; may change application state')
    browser.add_argument('--allow-writes', action='store_true', help='Enable mutating HTTP methods; requires --allow-interactions and isolated nonproduction approval')
    visual = sub.add_parser('visual-enforce', help='Run independent DOM/rendered visual hard checks in approved local Chromium')
    visual.add_argument('spec', help='Source-bound golden.visual-enforcement.v1 JSON request')
    visual.add_argument('--output', required=True, help='New or empty evidence directory outside source_root')
    visual.add_argument('--playwright-module', help='Explicit project-local Playwright module; defaults to the module declared by the request')
    visual.add_argument('--browser-executable', help='Explicit approved Chromium binary; defaults to Playwright bundled executable')
    visual.add_argument('--allow-remote', action='store_true', help='Allow explicitly listed remote origins; loopback only is the default')
    visual.add_argument('--allow-interactions', action='store_true', help='Enable declared click/fill/press/hover actions')
    visual.add_argument('--allow-writes', action='store_true', help='Allow mutating HTTP only for isolated_nonproduction=true requests')
    visual.add_argument('--gzip-evidence', action='store_true', help='Store complete DOM and report JSON as lossless gzip plus a compact integrity-bound index')
    api = sub.add_parser('api-contract', help='Check a frontend route against backend-generated OpenAPI and optional observed request evidence')
    api.add_argument('request_json', help='JSON with contract, client_route, openapi_document, optional observed and expected_identity')
    continuity = sub.add_parser('navigation-continuity', help='Check source-bound state continuity across a native-keyboard skip-link transition')
    continuity.add_argument('record_json')
    patch_manifest = sub.add_parser('patch-manifest', help='Create a complete byte-and-mode patch manifest from two source trees')
    patch_manifest.add_argument('--before-root', required=True)
    patch_manifest.add_argument('--after-root', required=True)
    patch_manifest.add_argument('--output', required=True, help='New manifest output path outside both source roots')
    patch_replay = sub.add_parser('patch-replay', help='Replay and exactly reverse a manifest in a new disposable source copy')
    patch_replay.add_argument('manifest_json')
    patch_replay.add_argument('--before-root', required=True)
    patch_replay.add_argument('--after-root', required=True)
    patch_replay.add_argument('--scratch-root', required=True, help='New isolated replay workspace; never either source tree')
    gates = sub.add_parser('gate-evidence', help='Validate exactly six source-bound hard-gate records; does not authenticate a runner or grant approval')
    gates.add_argument('records_json', help='JSON array with one record for each fixed hard-gate ID')
    gates.add_argument('--expected-bindings', required=True, help='JSON object of expected source/catalog/profile/checker binding values')
    gates.add_argument('--evidence-root', required=True, help='Directory that contains referenced evidence files')
    run_gates = sub.add_parser('evaluate-gates', help='Execute the registered G1-G6 validators from exact-bound JSON inputs; local results never authenticate promotion')
    run_gates.add_argument('request_json', help='Structured request containing validator input artifact references')
    run_gates.add_argument('--expected-bindings', required=True, help='Separate operator-supplied JSON binding record; not an approval or signature')
    run_gates.add_argument('--evidence-root', required=True, help='Existing directory containing all hash-addressed validator inputs and evidence')
    sub.add_parser('digest', help='Print exact SHA256 of the canonical pattern catalog')
    return parser


def main(argv=None):
    p = create_parser()
    args = p.parse_args(argv)
    try:
        if args.action == 'patterns': result = patterns_index()
        elif args.action == 'pattern': result = get_pattern(args.id)
        elif args.action == 'route': result = route_task(args.text, load_json(args.profile), args.ids, load_json(args.intent_spec))
        elif args.action == 'design-workflow':
            from .design_workflow import write_design_workflow
            packet = write_design_workflow(load_json(args.request_json), Path(args.output), source_root=Path(args.source_root))
            result = {
                'status': 'PREPARED_FOR_ISOLATED_PROTOTYPE',
                'context_id': packet['plan']['context_id'],
                'selected_direction': packet['plan']['selection']['selected_alternative_id'],
                'pattern_ids': packet['plan']['routing']['all_relevant_pattern_ids'],
                'skill_sources': packet['delivery_manifest']['source_bound_skill_bodies'],
                'output_dir': packet['output_dir'],
                'plan_sha256': packet['plan_sha256'],
                'agent_context_sha256': packet['agent_context_sha256'],
                'authenticated_delivery': False,
                'g6_status': 'UNKNOWN',
                'rendered_visual_qa': 'NOT_RUN',
            }
        elif args.action == 'design-session':
            from .design_execution import finish_session, prepare_session
            if args.session_action == 'start':
                result = prepare_session(load_json(args.request_json), Path(args.source_root), Path(args.output))
            else:
                result = finish_session(Path(args.session_dir), Path(args.submission),
                    gate_request_path=Path(args.gate_request) if args.gate_request else None)
        elif args.action == 'profile':
            x = load_json(args.json_path)
            result = {'digest': canonical_hash(x)} if args.digest_only and isinstance(x,dict) else validate_profile(x)
        elif args.action == 'plan': result = check_plan(load_json(args.json_path), load_json(args.profile))
        elif args.action == 'proofs': result = proof_audit(load_json(args.json_path),args.source_revision,catalog_digest())
        elif args.action == 'geometry': result = geometry_compare(load_json(args.before),load_json(args.after))
        elif args.action == 'digest': result = {'catalog_sha256':catalog_digest()}
        elif args.action == 'api-contract':
            from .backend_contracts import evaluate_backend_openapi_contract
            from .data_api_gates import combine, evaluate_api_contract
            request = load_json(args.request_json)
            if not isinstance(request, dict) or not {"contract", "client_route", "openapi_document"} <= set(request) or set(request) - {"contract", "client_route", "openapi_document", "observed", "expected_identity"}:
                raise ValueError('api-contract request must contain contract, client_route, openapi_document, and optional observed/expected_identity only')
            backend = evaluate_backend_openapi_contract(request["contract"], request["client_route"], request["openapi_document"])
            if backend.get("status") != 'PASS':
                result = {"status": backend.get("status", "BLOCKED"), "backend_contract": backend, "request_observation": {"status": "NOT_RUN", "reasons": ["backend contract did not pass"]}}
            else:
                observed = request.get("observed")
                runtime = evaluate_api_contract(request["contract"], request["client_route"], backend["server_route"], observed, request.get("expected_identity"))
                combined = combine(backend, runtime)
                result = {"status": combined["status"], "backend_contract": backend, "request_observation": runtime,
                          "scope": "backend route contract and optional observed request; not browser visual evidence"}
        elif args.action == 'navigation-continuity':
            from .navigation_gates import evaluate_navigation_continuity
            result = evaluate_navigation_continuity(load_json(args.record_json))
        elif args.action == 'patch-manifest':
            import os
            from .patch_integrity import build_patch_manifest
            before, after = Path(args.before_root).resolve(strict=True), Path(args.after_root).resolve(strict=True)
            output = Path(args.output).resolve(strict=False)
            if output.exists() or output.is_symlink() or output == before or output == after or output.is_relative_to(before) or output.is_relative_to(after):
                raise ValueError('manifest output must be a new file outside both source roots')
            if not output.parent.is_dir(): raise ValueError('manifest output parent must already exist')
            manifest = build_patch_manifest(before, after)
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream: json.dump(manifest, stream, indent=2); stream.write('\n')
            result = {"status": "PASS", "manifest_path": str(output), "manifest_sha256": __import__('hashlib').sha256(output.read_bytes()).hexdigest(),
                      "patch_sha256": manifest["patch_sha256"], "changed_files": len(manifest["files"]), "permission_modes_included": True}
        elif args.action == 'patch-replay':
            from .patch_integrity import replay_and_reverse
            result = replay_and_reverse(load_json(args.manifest_json), Path(args.before_root), Path(args.after_root), Path(args.scratch_root))
        elif args.action == 'gate-evidence':
            from .hard_gates import evaluate_six_gate_records
            records = load_json(args.records_json)
            expected = load_json(args.expected_bindings)
            root = Path(args.evidence_root)
            if not isinstance(records, list) or not isinstance(expected, dict) or not root.is_dir():
                raise ValueError('records must be an array, expected-bindings must be an object, and evidence root must exist')
            result = evaluate_six_gate_records(records, expected_bindings=expected, evidence_root=root)
        elif args.action == 'evaluate-gates':
            import hashlib
            from .gate_pipeline import evaluate_request
            request = load_json(args.request_json)
            expected_path = Path(args.expected_bindings)
            expected = load_json(args.expected_bindings)
            expected_digest = hashlib.sha256(expected_path.read_bytes()).hexdigest()
            result = evaluate_request(request, evidence_root=args.evidence_root,
                expected_bindings=expected, expected_bindings_sha256=expected_digest,
                command='golden-uiux evaluate-gates')
        elif args.action == 'browser':
            from .browser_audit import run
            result = run(load_json(args.spec),Path(args.output),args.allow_remote,allow_interactions=args.allow_interactions,allow_writes=args.allow_writes)
        elif args.action == 'visual-enforce':
            from .visual_enforcement import run_visual_enforcement
            result = run_visual_enforcement(Path(args.spec), Path(args.output),
                allow_remote=args.allow_remote, allow_interactions=args.allow_interactions,
                allow_writes=args.allow_writes, playwright_module=args.playwright_module,
                browser_executable=args.browser_executable, gzip_evidence=args.gzip_evidence)
        else: p.error('unsupported action')
        if args.action == 'visual-enforce' and args.gzip_evidence:
            routes=[]
            for route in result.get('routes',[]):
                counts={}
                for finding in route.get('findings',[]):
                    code=finding.get('code','UNKNOWN_CODE');counts[code]=counts.get(code,0)+1
                routes.append({'name':route.get('name'),'status':route.get('status'),'finding_counts':counts,'screenshot':route.get('screenshot'),'dom':route.get('dom')})
            output={'schema':result.get('schema'),'status':result.get('status'),'source_binding':result.get('source_binding'),'unconfigured':result.get('unconfigured'),'hard_gate_scope':result.get('hard_gate_scope'),'routes':routes,'process':result.get('process')}
            print(json.dumps(output,indent=2,ensure_ascii=False,sort_keys=True))
        else:
            print(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True))
        if args.action in {'browser', 'visual-enforce', 'gate-evidence', 'evaluate-gates', 'api-contract', 'navigation-continuity'} and result.get('status') != 'PASS':return 3
        if args.action == 'route' and str(result.get('decision','')).startswith('BLOCKED'): return 3
        return 0
    except (ValueError,KeyError,TypeError,json.JSONDecodeError,OSError) as exc:
        print(json.dumps({'error':str(exc),'status':'BLOCKED'},ensure_ascii=False),file=sys.stderr)
        return 2

if __name__ == '__main__': sys.exit(main())
