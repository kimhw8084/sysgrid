"""Deterministic offline UI/UX catalog routing and contract review.

All outputs are advisory specifications, never active authorization or test PASS.
"""
from __future__ import annotations
import hashlib
import json
import re
import math
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from .gate_ids import GATE_IDS, PROMOTION_CONTROLS

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
VALID_IDS = tuple(f"P{i:02d}" for i in range(1, 15))
STATUS_VALUES = frozenset({"NOT_RUN", "PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE", "WAIVED"})

# Transparent dictionary of candidate classification hints, NOT an ML validity claim.
KEYWORDS = {
    "P01": ("navigation", "nav", "sidebar", "breadcrumb", "routing", "route", "page shell", "tabs", "header"),
    "P02": ("table", "grid", "row", "records", "list", "search", "filter", "sorting", "pagination", "bulk selection"),
    "P03": ("details", "inspector", "record detail", "profile page", "record history", "detail view"),
    "P04": ("form", "edit", "editing", "editable", "input", "validation", "save", "draft", "submit", "field"),
    "P05": ("action", "toolbar", "button", "bulk action", "delete", "undo", "command"),
    "P06": ("dialog", "modal", "popover", "drawer", "menu", "overlay", "combobox"),
    "P07": ("chart", "dashboard", "graph", "analytics", "trend", "metric", "kpi", "visualization"),
    "P08": ("monitoring", "status", "alert", "incident", "health", "severity", "freshness"),
    "P09": ("loading", "empty", "error", "offline", "retry", "timeout", "permission", "unknown state"),
    "P10": ("responsive", "mobile", "zoom", "viewport", "breakpoint", "density", "compact", "reflow", "layout"),
    "P11": ("theme", "color", "token", "typography", "font", "palette", "spacing", "motion", "dark mode"),
    "P12": ("accessibility", "a11y", "keyboard", "screen reader", "aria", "focus", "contrast", "wcag"),
    "P13": ("collaboration", "autosave", "concurrent", "persist", "preferences", "saved view", "conflict"),
    "P14": ("localization", "translation", "i18n", "language", "copy", "label", "feedback", "plural"),
}


@lru_cache(maxsize=1)
def catalog() -> dict:
    data = json.loads((DATA / "patterns.json").read_text(encoding="utf-8"))
    patterns = data.get("patterns", [])
    if len(patterns) != 14 or {p.get("id") for p in patterns} != set(VALID_IDS):
        raise ValueError("Catalog is incomplete or contains unexpected IDs")
    for p in patterns:
        for key in ("id", "family", "select", "avoid", "states", "accept", "probes", "escalate"):
            if not p.get(key):
                raise ValueError(f"Catalog {p.get('id')!r} lacks {key}")
    return data


def catalog_digest() -> str:
    return hashlib.sha256((DATA / "patterns.json").read_bytes()).hexdigest()


def patterns_index() -> dict:
    return {
        "catalog_digest": catalog_digest(),
        "status": "CANDIDATE_NOT_ORGANIZATION_APPROVED",
        "patterns": [{"id": p["id"], "family": p["family"], "intent": p.get("intent", "")} for p in catalog()["patterns"]],
    }


def get_pattern(pattern_id: str) -> dict:
    if pattern_id not in VALID_IDS:
        raise ValueError("Unknown pattern ID; allowed P01 through P14")
    return next(p for p in catalog()["patterns"] if p["id"] == pattern_id)


def canonical_hash(value: dict) -> str:
    """Hash JSON excluding the self-referential profile_digest metadata key."""
    without = {k: v for k, v in value.items() if k != "profile_digest"}
    raw = json.dumps(without, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def validate_profile(profile: object | None) -> dict:
    if profile is None:
        return {"valid": False, "claimed_approved": False, "externally_verified_approval": False, "issues": ["No project profile supplied; no authorization to invent project identity or brand."], "digest": None}
    if not isinstance(profile, dict):
        return {"valid": False, "claimed_approved": False, "externally_verified_approval": False, "issues": ["Profile must be a JSON object."], "digest": None}
    errors = []
    for field in ("project_id", "profile_id", "profile_version", "source_revision", "component_registry", "token_profile", "density_modes", "accessibility_policy", "geometry_baselines", "quality_gate_map", "promotion_controls"):
        if field not in profile or profile[field] in (None, ""):
            errors.append(f"Missing required profile field {field}")
    for field in ("project_id", "profile_id", "profile_version", "source_revision"):
        if field in profile and not isinstance(profile[field], str):
            errors.append(f"{field} must be a string")
    for field in ("component_registry", "token_profile", "density_modes", "accessibility_policy", "quality_gate_map", "promotion_controls"):
        if field in profile and not isinstance(profile[field], dict):
            errors.append(f"{field} must be an object")
    expected_profile_statuses = {"NOT_RUN", "PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE", "WAIVED", "UNKNOWN"}
    if isinstance(profile.get("quality_gate_map"), dict):
        actual = set(profile["quality_gate_map"])
        if actual != set(GATE_IDS):
            errors.append("quality_gate_map must contain exactly the canonical G1–G6 identifiers")
        if any(value not in expected_profile_statuses for value in profile["quality_gate_map"].values()):
            errors.append("quality_gate_map contains an unsupported evidence status")
    if isinstance(profile.get("promotion_controls"), dict):
        actual = set(profile["promotion_controls"])
        if actual != set(PROMOTION_CONTROLS):
            errors.append("promotion_controls must contain exactly the separately named promotion controls")
        if any(value not in expected_profile_statuses for value in profile["promotion_controls"].values()):
            errors.append("promotion_controls contains an unsupported evidence status")
    if "geometry_baselines" in profile and not isinstance(profile["geometry_baselines"], list):
        errors.append("geometry_baselines must be an array")
    status = profile.get("approval_status", "UNKNOWN")
    if status not in ("PROPOSED", "APPROVED", "REVOKED", "EXPIRED", "UNKNOWN"):
        errors.append("Invalid approval_status")
    digest = canonical_hash(profile)
    if profile.get("profile_digest") != digest:
        errors.append("profile_digest does not match canonical JSON payload")
    if status == "APPROVED" and not profile.get("reviewer_identity_reference"):
        errors.append("APPROVED profile requires accountable reviewer reference")
    if status in ("REVOKED", "EXPIRED"):
        errors.append(f"Profile is {status}; cannot use for active design decisions")
    valid = not errors
    # Profile string assertions are not independently verified organizational approvals.
    return {"valid": valid, "claimed_approved": valid and status == "APPROVED", "externally_verified_approval": False, "issues": errors, "digest": digest}


def keyword_hits(text: str) -> dict[str, list[str]]:
    text = " ".join(text.lower().split())
    scores = {}
    for pattern_id, terms in KEYWORDS.items():
        hits = []
        for term in terms:
            escaped = re.escape(term).replace(r"\ ", r"\s+")
            if re.search(r"(?<!\w)" + escaped + r"(?!\w)", text):
                hits.append(term)
        if hits:
            scores[pattern_id] = hits
    return scores


INTENT_PATTERN_MAP = {
    "maintenance_work_queue": ("P02", "P03", "P08"),
    "rack_spatial_inventory": ("P02", "P03"),
    "record_detail_inspection": ("P03",),
    "record_editing": ("P04", "P05"),
    "form_submission": ("P04", "P06"),
    "service_monitoring": ("P07", "P08"),
    "analytics_dashboard": ("P07",),
    "navigation_shell": ("P01",),
}

# These mappings describe application components/capabilities, not words in a
# task title. They add a pattern only when the structured intake names the need.
COMPONENT_PATTERN_MAP = {
    "app_shell": ("P01",), "navigation": ("P01",),
    "record_grid": ("P02",), "record_search": ("P02",),
    "record_filter": ("P02",), "spatial_map": ("P02",),
    "rack_elevation": ("P02",), "selection_controls": ("P02",),
    "record_inspector": ("P03",), "asset_details": ("P03",),
    "form": ("P04",), "field_validation": ("P04",),
    "toolbar_actions": ("P05",), "dialog": ("P06",),
    "status_indicators": ("P08",), "empty_error_states": ("P09",),
    "responsive_layout": ("P10",), "theme_tokens": ("P11",),
    "keyboard_accessible": ("P12",), "persistent_selection": ("P13",),
    "persisted_preferences": ("P13",), "localized_feedback": ("P14",),
}

CONSTRAINT_PATTERN_MAP = {
    "explicit_recovery_states": ("P09",),
    "responsive_viewports": ("P10",),
    "preserve_visual_identity": ("P11",),
    "keyboard_accessible": ("P12",),
    "preserve_selection_context": ("P13",),
    "localized_copy": ("P14",),
}

SAFE_DEFAULTS_WITHOUT_PROFILE = (
    "Use native semantic HTML and platform controls.",
    "Invent no brand tokens; an isolated prototype may reuse only explicitly source-observed conventions, otherwise use system fonts and neutral surfaces.",
    "Keep content in a reflowing layout and preserve access at narrow viewports.",
    "Use only data, permissions and behavior stated in the task or verified source observations.",
)
PROFILE_BLOCKED_REQUIREMENTS = (
    "integrating changes into an existing product",
    "changing product-specific tokens, approved components or persistent preferences",
    "changing data, API, permissions or tenant behavior",
    "claiming supported viewports or organization approval",
)


def route_task(task: str, profile: dict | None = None, explicit_patterns: list[str] | None = None,
               intent_spec: dict | None = None) -> dict:
    """Route from explicit product intent and component needs.

    Keyword hits are returned as diagnostics only; they never select or inject a
    pattern. Callers without a structured intent receive no selected patterns.
    """
    if not isinstance(task, str) or not task.strip():
        raise ValueError("Task must be a nonempty description")
    if len(task) > 8000:
        raise ValueError("Task description exceeds the 8000-character bound")
    hits = keyword_hits(task)
    profile_check = validate_profile(profile)
    scope_mode = intent_spec.get("scope_mode", "existing_product_change") if isinstance(intent_spec, dict) else "existing_product_change"
    profile_usable = bool(profile_check["valid"] and profile_check["claimed_approved"] and profile_check["externally_verified_approval"])
    profile_state = ("ABSENT" if profile is None else "INVALID" if not profile_check["valid"]
                     else "APPROVAL_CLAIM_UNVERIFIED" if profile_check["claimed_approved"]
                     else "UNAPPROVED")
    profile_policy = {
        "state": profile_state,
        "safe_defaults": list(SAFE_DEFAULTS_WITHOUT_PROFILE) if not profile_usable else [],
        "blocked_requirements": list(PROFILE_BLOCKED_REQUIREMENTS) if not profile_usable else [],
        "scope_mode": scope_mode,
        "isolated_prototype_permitted": scope_mode == "isolated_prototype",
        "exploratory_design_permitted": scope_mode in {"isolated_prototype", "new_product_exploration"},
        "product_integration_permitted": False if not profile_usable else "requires_separate_source_authorization",
        "external_profile_approval_verified": False,
    }
    irrelevant = []
    if not isinstance(intent_spec, dict):
        intent_decision = "NEEDS_STRUCTURED_INTENT"
        primary, more, reasons = [], [], {}
    else:
        intent_id = intent_spec.get("intent_id")
        component_needs = intent_spec.get("component_needs", [])
        constraints = intent_spec.get("constraints", [])
        workflow_steps = intent_spec.get("workflow_steps", [])
        valid_list = lambda value: isinstance(value, list) and all(isinstance(x, str) and x for x in value)
        allowed_intent_fields = {"intent_id", "workflow_steps", "component_needs", "constraints", "scope_mode"}
        if (set(intent_spec) - allowed_intent_fields or scope_mode not in {"isolated_prototype", "existing_product_change", "new_product_exploration"}
                or intent_id not in INTENT_PATTERN_MAP or not valid_list(component_needs) or not valid_list(constraints)
                or not valid_list(workflow_steps) or not workflow_steps):
            intent_decision = "BLOCKED_INVALID_OR_INCOMPLETE_INTENT_SPEC"
            primary, more, reasons = [], [], {}
        else:
            unknown_components = sorted(set(component_needs) - set(COMPONENT_PATTERN_MAP))
            unknown_constraints = sorted(set(constraints) - set(CONSTRAINT_PATTERN_MAP))
            if unknown_components or unknown_constraints:
                intent_decision = "BLOCKED_UNKNOWN_COMPONENT_OR_CONSTRAINT"
                primary, more, reasons = [], [], {}
            else:
                primary = list(INTENT_PATTERN_MAP[intent_id])
                reasons = {pattern_id: [f"intent_spec.intent_id:{intent_id}"] for pattern_id in primary}
                for component in component_needs:
                    for pattern_id in COMPONENT_PATTERN_MAP[component]:
                        reasons.setdefault(pattern_id, []).append(f"intent_spec.component_needs:{component}")
                for constraint in constraints:
                    for pattern_id in CONSTRAINT_PATTERN_MAP[constraint]:
                        reasons.setdefault(pattern_id, []).append(f"intent_spec.constraints:{constraint}")
                more = [pattern_id for pattern_id in VALID_IDS if pattern_id in reasons and pattern_id not in primary]
                if explicit_patterns is not None:
                    if not isinstance(explicit_patterns, list) or any(x not in VALID_IDS for x in explicit_patterns):
                        raise ValueError("explicit_patterns must contain only P01–P14")
                    irrelevant = sorted(set(explicit_patterns) - set(reasons))
                    intent_decision = "BLOCKED_IRRELEVANT_PATTERN_INJECTION" if irrelevant else "ROUTED_FROM_STRUCTURED_INTENT"
                else:
                    irrelevant = []
                    intent_decision = "ROUTED_FROM_STRUCTURED_INTENT"
    all_ids = list(dict.fromkeys(primary + more))
    if intent_decision.startswith("BLOCKED"):
        decision = intent_decision
    elif intent_decision == "NEEDS_STRUCTURED_INTENT":
        decision = intent_decision
    elif not profile_usable and scope_mode not in {"isolated_prototype", "new_product_exploration"}:
        decision = "BLOCKED_PROFILE_REQUIRED_FOR_PRODUCT_IMPLEMENTATION"
    else:
        decision = "ROUTED_FOR_ISOLATED_DESIGN" if scope_mode in {"isolated_prototype", "new_product_exploration"} else "ROUTED_PROFILE_APPROVAL_REQUIRED"
    return {
        "decision": decision,
        "intent_decision": intent_decision,
        "intent_id": intent_spec.get("intent_id") if isinstance(intent_spec, dict) else None,
        "selection_basis": "STRUCTURED_INTENT_COMPONENT_NEEDS_AND_DECLARED_CONSTRAINTS",
        "primary_pattern_ids": primary,
        "other_applicable_pattern_ids": more,
        "cross_cutting_pattern_ids": [pattern_id for pattern_id in more if any(
            reason.startswith("intent_spec.constraints:") for reason in reasons.get(pattern_id, []))],
        "all_relevant_pattern_ids": all_ids,
        "pattern_reasons": reasons,
        "keyword_evidence_diagnostic_only": hits,
        "rejected_explicit_patterns": irrelevant if isinstance(intent_spec, dict) else list(explicit_patterns or []),
        "profile_check": profile_check,
        "profile_policy": profile_policy,
        "catalog_digest": catalog_digest(),
        "proof_state": "NOT_RUN",
        "authorization_state": "NOT_GRANTED_BY_THIS_TOOL",
        "limitations": ["Task keyword hits are diagnostic only and never choose patterns.", "All applicable mandatory requirements remain in force even if a skill is not loaded.", "No actual UX/accessibility checks, authenticated live skill delivery, or Git authorization occurred."],
    }


def check_plan(plan: object, profile: dict | None) -> dict:
    if not isinstance(plan, dict):
        raise ValueError("plan must be an object")
    issues = []
    for name in ("task_id", "source_revision", "pattern_ids", "state_matrix", "acceptance_cases", "risk_scope"):
        if name not in plan or plan[name] in (None, "", [], {}):
            issues.append(f"Missing or empty plan field: {name}")
    ids = plan.get("pattern_ids", [])
    if not isinstance(ids, list) or any(p not in VALID_IDS for p in ids):
        issues.append("pattern_ids must be a list of P01–P14 IDs")
    for field in ("state_matrix", "acceptance_cases", "risk_scope"):
        if field in plan and not isinstance(plan[field], (dict, list)):
            issues.append(f"{field} must be a structured object or list")
    if plan.get("claims_complete") is True:
        issues.append("Plan cannot self-certify complete qualification")
    prof = validate_profile(profile)
    if not prof["valid"]:
        issues.append("Project profile unresolved or invalid")
    elif not prof["claimed_approved"]:
        issues.append("Project profile is not APPROVED")
    return {"status": "STRUCTURAL_REVIEW_ONLY", "structurally_complete": not issues, "issues": issues, "profile": prof, "source_bound_proofs": "NOT_RUN", "release_authorization": "NOT_GRANTED"}


# One required metadata contract across schema, written policy and the runtime audit.
PROOF_REQUIRED_FIELDS = (
    'rule_id','gate_id','phase','applicability','status','source_revision',
    'source_tree_digest','catalog_digest','profile_digest','environment',
    'check_identity','test_command_or_case','started_at','completed_at',
    'runner_identity','reviewer_authority','reviewer_independence',
    'evidence_artifact','evidence_digest','evidence_location',
    'dependency_fingerprint',
)


def _timestamp(s: object) -> datetime | None:
    if not isinstance(s,str) or not s.strip():return None
    try:
        d=datetime.fromisoformat(s.replace('Z','+00:00'))
        return d if d.tzinfo is not None and d.utcoffset() is not None else None
    except ValueError:return None


def proof_audit(proofs: object, expected_source_revision: str | None = None, catalog_sha: str | None = None) -> dict:
    """Check ALL metadata required by the canonical contract; cannot attest its truth."""
    if not isinstance(proofs,list):raise ValueError('Proofs must be a list')
    issues=[];counts={k:0 for k in sorted(STATUS_VALUES)}
    schema=json.loads((DATA/'proof_schema.json').read_text(encoding='utf-8'))
    known_fields=set(schema['properties'])
    for idx,rec in enumerate(proofs):
        prefix=f'proof[{idx}]'
        if not isinstance(rec,dict):issues.append(f'{prefix}: record must be an object');continue
        status=rec.get('status','NOT_RUN')
        if status not in STATUS_VALUES:issues.append(f'{prefix}: unsupported status {status}');continue
        counts[status]+=1
        for unexpected in sorted(set(rec)-known_fields):
            issues.append(f'{prefix}: unexpected field {unexpected}')
        for k in PROOF_REQUIRED_FIELDS:
            v=rec.get(k)
            if v is None or v=='' or (isinstance(v,dict) and not v):
                issues.append(f'{prefix}: missing {k}')
            elif k not in ('environment','dependency_fingerprint') and not isinstance(v,str):
                issues.append(f'{prefix}: {k} must be a string')
            elif k in ('environment','dependency_fingerprint') and not isinstance(v,dict):
                issues.append(f'{prefix}: {k} must be an object')
        if rec.get('gate_id') not in GATE_IDS:
            issues.append(f'{prefix}: invalid gate_id')
        if rec.get('phase') not in ('DESIGN','DEVELOPMENT','PROMOTION'):
            issues.append(f'{prefix}: invalid phase')
        if rec.get('applicability') not in ('APPLICABLE','NOT_APPLICABLE','UNKNOWN'):
            issues.append(f'{prefix}: invalid applicability')
        if status=='NOT_APPLICABLE' and rec.get('applicability')!='NOT_APPLICABLE':
            issues.append(f'{prefix}: N/A requires applicability NOT_APPLICABLE')
        if status=='NOT_APPLICABLE' and not rec.get('applicability_reason'):
            issues.append(f'{prefix}: N/A requires a recorded independent applicability reason')
        if status in ('PASS','FAIL') and rec.get('applicability')!='APPLICABLE':
            issues.append(f'{prefix}: executed result requires APPLICABLE')
        if status=='WAIVED' and not all(rec.get(k) for k in ('waiver_owner','waiver_reason','waiver_expiration','waiver_authority')):
            issues.append(f'{prefix}: waiver lacks owner, reason or expiry or authority')
        if not isinstance(rec.get('environment'),dict) or not rec.get('environment'):
            issues.append(f'{prefix}: environment must be a nonempty object')
        if not isinstance(rec.get('dependency_fingerprint'),dict) or not rec.get('dependency_fingerprint'):
            issues.append(f'{prefix}: dependency_fingerprint must be a nonempty object')
        a,b=_timestamp(rec.get('started_at')),_timestamp(rec.get('completed_at'))
        if a is None or b is None:issues.append(f'{prefix}: timestamps must be timezone-aware ISO 8601 strings')
        elif b<a:issues.append(f'{prefix}: completed_at earlier than started_at')
        if expected_source_revision and rec.get('source_revision')!=expected_source_revision:
            issues.append(f'{prefix}: stale source revision')
        if catalog_sha and rec.get('catalog_digest')!=catalog_sha:
            issues.append(f'{prefix}: catalog digest mismatch')
        if status=='PASS' and not all(rec.get(k) for k in ('runner_identity','evidence_artifact','evidence_digest','reviewer_independence')):
            issues.append(f'{prefix}: PASS lacks runner/artifact/digest/reviewer independence fields')
    if not proofs:issues.append('No proof records supplied')
    if any(counts[s] for s in ('FAIL','BLOCKED','NOT_RUN')):
        issues.append('At least one mandatory proof is not PASS or appropriately adjudicated')
    return {
        'status':'BLOCKED_EXTERNAL_ATTESTATION_REQUIRED','metadata_complete':not issues,
        'metadata_schema':'data/proof_schema.json','counts':counts,'issues':issues,
        'promotion_permitted':False,'externally_attested':False,
        'reason':'Even complete caller-provided metadata is not authenticated CI/reviewer evidence.'
    }


GEOMETRY_DIRECTIONS=frozenset({'unchanged','no_increase','no_decrease','bounded'})

def _isfinite_number(value):
    return isinstance(value,(float,int)) and not isinstance(value,bool) and math.isfinite(value)


def geometry_compare(before: object, after: object) -> dict:
    """Numeric comparison with declared per-metric direction and bidirectional bounds."""
    if not isinstance(before,dict) or not isinstance(after,dict):raise ValueError('Geometry snapshots must be objects')
    for name,snapshot in (('before',before),('after',after)):
        if not isinstance(snapshot.get('context'),dict) or not isinstance(snapshot.get('measurements'),dict):
            raise ValueError(f'{name} must contain context and measurements objects')
    allowed_context=after.get('allowed_context_changes',[])
    if not isinstance(allowed_context,list) or any(k not in ('theme','locale') for k in allowed_context):
        return {'status':'BLOCKED','reason':'Unapproved context changes; only theme and locale may be explicitly compared','findings':[]}
    for key in set(before['context'])|set(after['context']):
        if key not in allowed_context and before['context'].get(key)!=after['context'].get(key):
            return {'status':'BLOCKED','reason':f'Context mismatch at {key}; measurements are not comparable','findings':[]}
    rules=after.get('metric_rules')
    if not isinstance(rules,dict) or not rules:
        return {'status':'UNKNOWN','reason':'Preapproved metric_rules with explicit directions are required','findings':[],'release_authorization':'NOT_GRANTED'}
    findings=[]
    for metric in sorted(set(before['measurements'])|set(after['measurements'])|set(rules)):
        old=before['measurements'].get(metric);new=after['measurements'].get(metric);rule=rules.get(metric)
        if not _isfinite_number(old) or not _isfinite_number(new):
            findings.append({'metric':metric,'status':'UNKNOWN','reason':'missing/nonfinite/non-numeric measurement'});continue
        if not isinstance(rule,dict) or rule.get('direction') not in GEOMETRY_DIRECTIONS:
            findings.append({'metric':metric,'status':'UNKNOWN','reason':'missing/invalid direction rule'});continue
        direction=rule['direction']
        allowed_increase=rule.get('max_increase',0 if direction in ('unchanged','no_increase','bounded') else None)
        allowed_decrease=rule.get('max_decrease',0 if direction in ('unchanged','no_decrease','bounded') else None)
        if direction=='bounded' and ('max_increase' not in rule or 'max_decrease' not in rule):
            findings.append({'metric':metric,'status':'UNKNOWN','reason':'bounded mode needs both limits'});continue
        if any(not _isfinite_number(v) or v<0 for v in (allowed_increase,allowed_decrease) if v is not None):
            findings.append({'metric':metric,'status':'UNKNOWN','reason':'invalid directional tolerance'});continue
        delta=new-old
        violation=(allowed_increase is not None and delta>allowed_increase) or (allowed_decrease is not None and delta < -allowed_decrease)
        findings.append({'metric':metric,'before':old,'after':new,'delta':delta,'direction':direction,
            'max_increase':allowed_increase,'max_decrease':allowed_decrease,
            'status':'REGRESSION' if violation else 'WITHIN_DECLARED_BOUNDS'})
    bad=any(x['status']=='REGRESSION' for x in findings)
    unknown=any(x['status']=='UNKNOWN' for x in findings)
    return {'status':'FAIL_GEOMETRY' if bad else 'UNKNOWN' if unknown else 'MEASUREMENTS_WITHIN_DECLARED_TOLERANCES',
        'findings':findings,'release_authorization':'NOT_GRANTED',
        'limitations':'Partial numeric check; clipping, focus, semantics and screenshot evidence must be checked independently. Rules require prior approval.'}

# Deterministic, non-authorizing feature intake; no invented coordinates or brand.
PATTERN_COMPONENT_ROLES={
 'P01':('app_shell','navigation'),'P02':('record_grid','table','search'),
 'P03':('record_detail','inspector'),'P04':('form','input'),
 'P05':('button','toolbar'),'P06':('dialog','dropdown_menu','tooltip'),
 'P07':('chart',),'P08':('monitoring_grid','status_badge'),
 'P09':('status','empty_state'),'P10':('responsive_layout',),
 'P11':('theme','tokens'),'P12':('accessible_controls',),
 'P13':('preferences',),'P14':('localized_copy',)}


def intake_brief(brief:object,profile:dict|None=None)->dict:
    """Return a reproducible design brief; candidate bindings are NOT an authorization."""
    if not isinstance(brief,dict):raise ValueError('Feature brief must be a JSON object')
    required=('user','job','data','permissions','intended_outcome','consequential_behavior','success_criteria','intent_spec')
    missing=[x for x in required if x not in brief or brief[x] in ('',None,[],{})]
    if any(len(str(brief.get(x,'')))>12000 for x in required):raise ValueError('Brief field too large')
    task=' '.join(str(brief.get(k,'')) for k in ('job','intended_outcome','data','consequential_behavior'))
    routed=route_task(task,profile,brief.get('pattern_ids'),brief.get('intent_spec'))
    registry=profile.get('component_registry',{}) if isinstance(profile,dict) else {}
    bindings={}
    for pid in routed['primary_pattern_ids']+routed['other_applicable_pattern_ids']:
        candidates=PATTERN_COMPONENT_ROLES[pid]
        matches={k:registry[k] for k in candidates if isinstance(registry,dict) and registry.get(k)}
        bindings[pid]={'semantic_roles':list(candidates),'observed_profile_bindings':matches,
                       'selection_state':'OBSERVED_NOT_AUTHORIZED' if matches else 'UNRESOLVED_PROJECT_BINDING'}
    return {'status':'INCOMPLETE_BRIEF' if missing else 'STRUCTURED_INTAKE_NOT_APPROVED',
       'missing_fields':missing,'brief':{k:brief.get(k) for k in required},
       'pattern_ids':routed['all_relevant_pattern_ids'],'primary_patterns':routed['primary_pattern_ids'],
       'component_bindings':bindings,'profile_status':routed['decision'],
       'required_proof_status':'NOT_RUN','scope_authorized':False,
       'notes':['Requested product outcomes do not require the user to specify margins, spacing or button colors.',
          'Unknown consequential behavior or permissions require product/owner clarification.',
          'Tool output does not grant permission to edit or publish.']}
