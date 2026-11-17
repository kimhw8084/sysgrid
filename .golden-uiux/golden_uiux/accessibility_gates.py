"""Fail-closed, offline accessibility evidence validators.

These pure validators check a supplied probe record. They do not execute a
browser, verify evidence hashes, or certify assistive technology. The caller
must authenticate provenance and obtain real browser/AT evidence when required.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any
from .gate_ids import G3_ACCESSIBILITY, G4_RENDERED_CONTRAST
from . import navigation_gates

STATUSES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "UNKNOWN", "NOT_APPLICABLE", "WAIVED"}
_HEX = re.compile(r"^#([0-9a-f]{3,8})$", re.I)
_NUM = r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?%?"
_RULES = {
    "A11Y_VISIBLE_FOCUS": [G3_ACCESSIBILITY, "P12"],
    "A11Y_CONTRAST": [G4_RENDERED_CONTRAST, "P11", "P12"],
    "A11Y_ACCESSIBLE_NAME": [G3_ACCESSIBILITY, "P12", "P14"],
    "A11Y_DIALOG_FOCUS": [G3_ACCESSIBILITY, "P06", "P12"],
    "A11Y_SKIP_LINK": [G3_ACCESSIBILITY, "P01", "P12"],
}
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_ARIA_ROLES = frozenset("""
alert alertdialog application article banner blockquote button caption cell checkbox code
columnheader combobox complementary contentinfo definition deletion dialog directory document
emphasis feed figure form generic grid gridcell group heading img insertion link list listbox
listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter
navigation none note option paragraph presentation progressbar radio radiogroup region row
rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript
superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem
""".split())


def _finite_number(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _source_bound(binding: object) -> bool:
    """Validate the envelope shape; an outer runner must authenticate its hashes."""
    if not isinstance(binding, dict): return False
    for key in ("source_revision", "source_tree_digest", "catalog_digest", "profile_digest", "checker_version", "artifact_digest"):
        if not isinstance(binding.get(key), str) or not _DIGEST.fullmatch(binding[key]):
            # source_revision/checker_version can be semantic identifiers; digests are checked separately.
            if key not in ("source_revision", "checker_version") or not isinstance(binding.get(key), str) or not binding[key].strip(): return False
    if not isinstance(binding.get("environment"),dict) or not binding["environment"]: return False
    for key in ("runner", "case_id", "started_at_utc", "completed_at_utc"):
        if not isinstance(binding.get(key),str) or not binding[key].strip(): return False
    return True


def _result(gate: str, status: str, findings: list[str], *, applicability: str = "APPLICABLE", source_binding: object = None, evidence: dict | None = None, **extra: Any) -> dict:
    if status not in STATUSES: raise ValueError(f"unsupported evidence status: {status}")
    if status == "PASS" and not _source_bound(source_binding):
        status="BLOCKED"; findings=[*findings,"PASS is blocked: exact source-bound execution evidence is incomplete."]
    rule_contract = _RULES.get(gate, [])
    gate_id = rule_contract[0] if rule_contract else "UNKNOWN_GATE"
    rule_ids = rule_contract[1:] if rule_contract else []
    return {"schema":"golden-uiux.gate-result.v1", "gate_id":gate_id, "check_id":gate, "status":status,
            "applicability":applicability, "rule_ids":rule_ids, "findings":findings,
            "evidence":evidence or {}, "source_binding":source_binding if isinstance(source_binding,dict) else {}, **extra}


def _prepare(gate: str, record: object) -> dict | None:
    if not isinstance(record,dict): return _result(gate,"NOT_RUN",["No execution record supplied."])
    app=record.get("applicability","APPLICABLE")
    if app=="UNKNOWN": return _result(gate,"UNKNOWN",["Applicability is unresolved."],applicability="UNKNOWN",source_binding=record.get("source_binding"))
    if app=="NOT_APPLICABLE":
        if not all(record.get(k) for k in ("applicability_reason","applicability_authority")):
            return _result(gate,"BLOCKED",["NOT_APPLICABLE requires an accountable applicability decision and rationale."],applicability="UNKNOWN",source_binding=record.get("source_binding"))
        return _result(gate,"NOT_APPLICABLE",[],applicability="NOT_APPLICABLE",source_binding=record.get("source_binding"),evidence={"reason":record["applicability_reason"],"authority":record["applicability_authority"]})
    if app=="WAIVED":
        if not all(record.get(k) for k in ("waiver_authority","waiver_reason","waiver_scope","waiver_expiry")):
            return _result(gate,"BLOCKED",["WAIVED requires authority, reason, scope, and expiry."],source_binding=record.get("source_binding"))
        return _result(gate,"WAIVED",[],source_binding=record.get("source_binding"),evidence={"authority":record["waiver_authority"],"reason":record["waiver_reason"],"scope":record["waiver_scope"],"expiry":record["waiver_expiry"]})
    if app!="APPLICABLE": return _result(gate,"BLOCKED",["Unsupported applicability state."],applicability="UNKNOWN",source_binding=record.get("source_binding"))
    if record.get("executed") is not True: return _result(gate,"NOT_RUN",["Required browser/interaction check was not executed."],source_binding=record.get("source_binding"))
    binding=record.get("source_binding")
    if not _source_bound(binding): return _result(gate,"BLOCKED",["Source-bound evidence envelope is incomplete; caller must authenticate all referenced artifacts."],source_binding=binding)
    return None


def _number(value: str) -> float | None:
    try:
        if value.endswith("%"):
            return float(value[:-1]) / 100
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_css_color(value: object) -> tuple[float, float, float, float] | None:
    """Parse hex, rgb(a), hsl(a), and in-sRGB-gamut oklch(); otherwise fail closed."""
    if not isinstance(value, str):
        return None
    text=value.strip().lower()
    m=_HEX.fullmatch(text)
    if m:
        raw=m.group(1)
        if len(raw) in (3,4): raw=''.join(c*2 for c in raw)
        if len(raw) not in (6,8): return None
        parts=[int(raw[i:i+2],16)/255 for i in range(0,len(raw),2)]
        return (*parts[:3], parts[3] if len(parts)==4 else 1.0)
    fn=re.fullmatch(r"([a-z0-9-]+)\((.*)\)",text)
    if not fn: return None
    name,body=fn.groups()
    # CSS space/comma forms; slash alpha is accepted for all supported functions.
    body=body.replace(',', ' ')
    if body.count('/')>1: return None
    halves=body.split('/')
    comps=halves[0].split()
    alpha=_number(halves[1].strip()) if len(halves)==2 else 1.0
    if alpha is None: return None
    if len(halves)==1 and name in ('rgba','hsla') and len(comps)==4:
        alpha=_number(comps.pop())
        if alpha is None: return None
    if len(comps)!=3: return None
    if name in ('rgb','rgba'):
        vals=[]
        for c in comps:
            n=_number(c)
            if n is None: return None
            vals.append(n if c.endswith('%') else n/255)
        return tuple(max(0.0,min(1.0,x)) for x in (*vals,alpha))
    if name in ('hsl','hsla'):
        htxt=comps[0]
        hm=re.fullmatch(r"("+_NUM+r")(deg|rad|turn|grad)?",htxt)
        if not hm: return None
        hv=float(hm.group(1)); unit=hm.group(2) or 'deg'
        h=(hv*360 if unit=='turn' else math.degrees(hv) if unit=='rad' else hv*0.9 if unit=='grad' else hv)%360/360
        sat=_number(comps[1]); light=_number(comps[2])
        if sat is None or light is None or not comps[1].endswith('%') or not comps[2].endswith('%'): return None
        s=max(0.0,min(1.0,sat)); l=max(0.0,min(1.0,light))
        c=(1-abs(2*l-1))*s; x=c*(1-abs((h*6)%2-1)); z=l-c/2
        if h<1/6: rgb=(c,x,0)
        elif h<2/6: rgb=(x,c,0)
        elif h<3/6: rgb=(0,c,x)
        elif h<4/6: rgb=(0,x,c)
        elif h<5/6: rgb=(x,0,c)
        else: rgb=(c,0,x)
        return (*(v+z for v in rgb),max(0.0,min(1.0,alpha)))
    if name=='oklch':
        L=_number(comps[0]); C=_number(comps[1])
        hm=re.fullmatch(r"("+_NUM+r")(deg|rad|turn|grad)?",comps[2])
        if L is None or C is None or hm is None: return None
        # CSS percentage chroma is defined against .4; permit explicit numeric too.
        if comps[1].endswith('%'): C*=0.4
        if comps[0].endswith('%'): L=max(0.0,min(1.0,L))
        hv=float(hm.group(1)); unit=hm.group(2) or 'deg'
        angle=(hv*360 if unit=='turn' else math.degrees(hv) if unit=='rad' else hv*0.9 if unit=='grad' else hv)%360
        a=C*math.cos(math.radians(angle)); b=C*math.sin(math.radians(angle))
        lp=L+0.3963377774*a+0.2158037573*b
        mp=L-0.1055613458*a-0.0638541728*b
        sp=L-0.0894841775*a-1.2914855480*b
        l,mv,sv=lp**3,mp**3,sp**3
        rgb=(4.0767416621*l-3.3077115913*mv+0.2309699292*sv,
             -1.2684380046*l+2.6097574011*mv-0.3413193965*sv,
             -0.0041960863*l-0.7034186147*mv+1.7076147010*sv)
        # Do not silently gamut-map: browser-specific mapping can change measured contrast.
        if any(v < -1e-6 or v > 1+1e-6 for v in rgb): return None
        return (*(max(0.0,min(1.0,v)) for v in rgb),max(0.0,min(1.0,alpha)))
    return None


def _composite(fg: tuple[float,float,float,float], bg: tuple[float,float,float,float]) -> tuple[float,float,float,float]:
    a=fg[3]+bg[3]*(1-fg[3])
    if a<=0: return (0.0,0.0,0.0,0.0)
    return tuple((fg[i]*fg[3]+bg[i]*bg[3]*(1-fg[3]))/a for i in range(3))+(a,)


def _luminance(rgb: tuple[float,float,float]) -> float:
    def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
    r,g,b=(lin(c) for c in rgb)
    return .2126*r+.7152*g+.0722*b



def evaluate_contrast(record: object) -> dict:
    """Evaluate one predeclared contrast pair from rendered-style evidence.

    `background_layers` order is opaque canvas/backdrop to nearest painted layer.
    Gradients, filters, backdrop effects, ancestor opacity or missing style-chain
    evidence must set `unresolved_compositing`; the result will be UNKNOWN.
    """
    gate='A11Y_CONTRAST'
    early=_prepare(gate,record)
    if early:return early
    if record.get('unresolved_compositing') is True: return _result(gate,'UNKNOWN',['Rendered backdrop/compositing could not be resolved.'],source_binding=record.get('source_binding'))
    if record.get('computed_style_pair') is not True or record.get('style_chain_complete') is not True:
        return _result(gate,'UNKNOWN',['Browser-computed color pair or complete ancestor style/compositing chain is missing.'],source_binding=record.get('source_binding'))
    if record.get('pair_id') is None: return _result(gate,'NOT_RUN',['Predeclared contrast pair ID is missing.'],source_binding=record.get('source_binding'))
    threshold=record.get('threshold')
    if not _finite_number(threshold) or not 1<=threshold<=21: return _result(gate,'BLOCKED',['A finite frozen threshold in [1, 21] is required.'],source_binding=record.get('source_binding'))
    fg=parse_css_color(record.get('foreground'))
    layers=record.get('background_layers')
    if fg is None or not isinstance(layers,list) or not layers: return _result(gate,'UNKNOWN',['Unsupported color or missing rendered background chain.'],source_binding=record.get('source_binding'))
    bg=None
    for raw in layers:
        layer=parse_css_color(raw)
        if layer is None: return _result(gate,'UNKNOWN',['Unsupported background color/gradient in compositing chain.'],source_binding=record.get('source_binding'))
        if bg is None:
            if layer[3]<1: return _result(gate,'UNKNOWN',['Backdrop chain has no opaque base layer.'],source_binding=record.get('source_binding'))
            bg=layer
        else: bg=_composite(layer,bg)
    if bg is None or bg[3]<1: return _result(gate,'UNKNOWN',['Rendered background is not opaque.'],source_binding=record.get('source_binding'))
    rendered_fg=_composite(fg,bg)
    L1,L2=sorted((_luminance(rendered_fg[:3]),_luminance(bg[:3])),reverse=True)
    ratio=(L1+.05)/(L2+.05)
    cross=record.get('rendered_crosscheck')
    if not isinstance(cross,dict) or not _finite_number(cross.get('ratio')) or not 1<=cross['ratio']<=21 or not isinstance(cross.get('artifact_digest'),str) or not _DIGEST.fullmatch(cross['artifact_digest']):
        return _result(gate,'UNKNOWN',['Independent rendered/raster contrast cross-check is missing or unbound.'],source_binding=record.get('source_binding'))
    tolerance=record.get('crosscheck_tolerance')
    if not _finite_number(tolerance) or tolerance<0 or abs(float(cross['ratio'])-ratio)>tolerance:
        return _result(gate,'UNKNOWN',['Computed contrast and rendered cross-check do not agree within the frozen tolerance.'],source_binding=record.get('source_binding'),evidence={'computed_ratio':round(ratio,6),'crosscheck_ratio':cross.get('ratio'),'tolerance':tolerance})
    if float(cross['ratio'])+1e-9<threshold:
        return _result(gate,'FAIL',[f'Rendered contrast {float(cross["ratio"]):.3f}:1 is below frozen threshold {threshold}:1.'],source_binding=record.get('source_binding'),evidence={'pair_id':record['pair_id'],'computed_ratio':round(ratio,6),'rendered_ratio':float(cross['ratio']),'threshold':threshold})
    status='PASS' if ratio+1e-9>=threshold else 'FAIL'
    return _result(gate,status,[] if status=='PASS' else [f'Computed contrast {ratio:.3f}:1 is below frozen threshold {threshold}:1.'],source_binding=record.get('source_binding'),evidence={'pair_id':record['pair_id'],'ratio':round(ratio,6),'rendered_ratio':float(cross['ratio']),'threshold':threshold,'rendered_fg':rendered_fg,'rendered_bg':bg,'crosscheck_artifact_digest':cross['artifact_digest']})


def evaluate_focus(record: object) -> dict:
    gate='A11Y_VISIBLE_FOCUS'
    early=_prepare(gate,record)
    if early:return early
    if record.get('native_keyboard') is not True: return _result(gate,'UNKNOWN',['Evidence does not establish native Tab/Shift+Tab traversal.'],source_binding=record.get('source_binding'))
    origin=record.get('origin_target')
    if record.get('valid_origin') is not True or not isinstance(origin,str) or not origin.strip(): return _result(gate,'BLOCKED',['Keyboard traversal did not start from a declared, identified valid route origin.'],source_binding=record.get('source_binding'))
    samples=record.get('samples')
    required=record.get('required_targets')
    sequence=record.get('key_sequence')
    if not isinstance(samples,list) or not isinstance(required,list) or not required or any(not isinstance(x,str) or not x.strip() for x in required) or len(set(required))!=len(required) or not isinstance(sequence,list) or not sequence:
        return _result(gate,'NOT_RUN',['Required target list or native key-event trace is missing.'],source_binding=record.get('source_binding'))
    if any(not isinstance(step,dict) or step.get('trusted') is not True for step in sequence):
        return _result(gate,'UNKNOWN',['Key trace contains synthetic/untrusted events; native reachability is unproven.'],source_binding=record.get('source_binding'))
    if any(not isinstance(step,dict) or step.get('key') not in ('Tab','Shift+Tab') or not step.get('from_target') or not step.get('to_target') for step in sequence):
        return _result(gate,'UNKNOWN',['Key trace is incomplete or does not record native traversal targets.'],source_binding=record.get('source_binding'))
    if sequence[0]['from_target']!=origin:
        return _result(gate,'UNKNOWN',['Native key trace does not begin at the declared route origin.'],source_binding=record.get('source_binding'))
    if any(a['to_target']!=b['from_target'] for a,b in zip(sequence,sequence[1:])):
        return _result(gate,'UNKNOWN',['Native key trace is discontinuous; traversal order cannot be established.'],source_binding=record.get('source_binding'))
    reached={step['to_target'] for step in sequence}
    missing=[x for x in required if x not in reached]
    if missing: return _result(gate,'FAIL',[f'Required controls not reached by native keyboard: {missing!r}.'],source_binding=record.get('source_binding'),evidence={'missing_targets':missing})
    matches={target:[s for s in samples if isinstance(s,dict) and s.get('target_id')==target] for target in required}
    duplicates=[target for target,items in matches.items() if len(items)>1]
    if duplicates:return _result(gate,'UNKNOWN',[f'Contradictory or duplicate rendered focus samples for required target(s): {duplicates!r}.'],source_binding=record.get('source_binding'))
    missing_samples=[x for x,items in matches.items() if not items]
    if missing_samples:return _result(gate,'NOT_RUN',['Native traversal reached controls without corresponding rendered focus samples.'],source_binding=record.get('source_binding'),evidence={'missing_samples':missing_samples})
    by_target={target:items[0] for target,items in matches.items()}
    failures=[];unknown=[]
    for target in required:
        s=by_target[target]
        if s.get('transition_settled') is not True: unknown.append(f'{target}: transition did not settle')
        elif not all(_finite_number(s.get(k)) for k in ('opacity','effective_opacity','rect_area')) or not 0<=s.get('opacity',-1)<=1 or not 0<=s.get('effective_opacity',-1)<=1 or s.get('rect_area',-1)<0: unknown.append(f'{target}: visibility geometry or ancestor opacity is incomplete/invalid')
        elif any(type(s.get(k)) is not bool for k in ('visible','hidden','inert','aria_hidden','disabled','focus_visible','indicator_perceptible')): unknown.append(f'{target}: visibility/focus evidence contains malformed boolean values')
        elif s.get('visibility') not in ('visible','hidden','collapse') or not isinstance(s.get('display'),str) or not s['display'].strip(): unknown.append(f'{target}: computed visibility/display style is missing or malformed')
        elif s.get('visible') is not True or s.get('hidden') is True or s.get('visibility') in ('hidden','collapse') or s.get('display')=='none' or s.get('inert') is True or s.get('aria_hidden') is True or s.get('disabled') is True or s.get('opacity')<=0 or s.get('effective_opacity')<=0 or s.get('rect_area')<=0:
            failures.append(f'{target}: focused control is not visibly operable')
        elif s.get('focus_visible') is not True: failures.append(f'{target}: focus-visible state absent')
        elif s.get('indicator_source')!='self': failures.append(f'{target}: focus indication is not on the focused control')
        elif not s.get('indicator_perceptible'): failures.append(f'{target}: own focus indicator is not perceptible')
        elif not isinstance(s.get('capture_digest'),str) or not _DIGEST.fullmatch(s['capture_digest']): unknown.append(f'{target}: rendered focus capture is missing or unbound')
        else:
            geometry = s.get('indicator_geometry')
            if not isinstance(geometry, dict) or geometry.get('capture_digest') != s.get('capture_digest'):
                unknown.append(f'{target}: focus-indicator geometry is missing or not from the same rendered state')
            else:
                from . import geometry_gates
                observation = {
                    'executed': True, 'case_id': f'focus-indicator:{target}',
                    'rect_space': geometry.get('rect_space'),
                    'transforms_applied': geometry.get('transforms_applied'),
                    'viewport': geometry.get('viewport'), 'target_bounds': geometry.get('bounds'),
                    'clip_ancestors': geometry.get('clip_ancestors'), 'target_kind': 'text',
                    'text_completeness': True, 'source_binding': {
                        'source_tree_sha256': record['source_binding']['source_tree_digest'],
                        'profile_sha256': record['source_binding']['profile_digest'],
                        'environment_sha256': hashlib.sha256(json.dumps(record['source_binding']['environment'], sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                        'test_selector': 'G3.focus.indicator-geometry',
                        'checker_version': record['source_binding']['checker_version']},
                    'evidence_hashes_verified': True,
                    'evidence_refs': [{'path': 'same-state-focus-capture', 'sha256': s['capture_digest']}],
                }
                measured = geometry_gates.evaluate_geometry_case(observation, {'tolerance_css_px': 0, 'text_visibility': 'full', 'page_overflow': 'allow_configured'})
                if measured.get('status') == 'FAIL':
                    failures.append(f'{target}: focus indicator is clipped or outside the viewport')
                elif measured.get('status') != 'PASS':
                    unknown.append(f'{target}: focus-indicator clipping could not be measured')
    if failures:return _result(gate,'FAIL',failures,source_binding=record.get('source_binding'))
    if unknown:return _result(gate,'UNKNOWN',unknown,source_binding=record.get('source_binding'))
    return _result(gate,'PASS',[],source_binding=record.get('source_binding'),evidence={'tested_targets':required,'keyboard':'native'})


def evaluate_accessible_name(record: object) -> dict:
    gate='A11Y_ACCESSIBLE_NAME'
    early=_prepare(gate,record)
    if early:return early
    if record.get('name_computation')!='accessibility_tree': return _result(gate,'UNKNOWN',['Name is not from a browser accessibility-tree computation.'],source_binding=record.get('source_binding'))
    if not isinstance(record.get('tree_capture_digest'),str) or not _DIGEST.fullmatch(record['tree_capture_digest']): return _result(gate,'UNKNOWN',['Accessibility-tree evidence is missing or unbound.'],source_binding=record.get('source_binding'))
    role=record.get('computed_role'); name=record.get('computed_name'); expected=record.get('expected_name')
    if not isinstance(role,str) or role.strip().lower() not in _ARIA_ROLES:
        return _result(gate,'UNKNOWN',['Computed role is missing, malformed, or not a recognized ARIA role token.'],source_binding=record.get('source_binding'))
    if not isinstance(name,str) or not name.strip():
        return _result(gate,'FAIL',['Interactive element has no computed accessible name.'],source_binding=record.get('source_binding'))
    if not isinstance(expected,str) or not expected.strip(): return _result(gate,'BLOCKED',['Expected semantic name from the frozen task is missing.'],source_binding=record.get('source_binding'))
    if name.strip()!=expected.strip(): return _result(gate,'FAIL',[f'Accessible name mismatch: expected {expected!r}, got {name!r}.'],source_binding=record.get('source_binding'),evidence={'computed_role':role,'computed_name':name})
    return _result(gate,'PASS',[],source_binding=record.get('source_binding'),evidence={'computed_role':role,'computed_name':name})


def evaluate_dialog_focus(record: object) -> dict:
    gate='A11Y_DIALOG_FOCUS'
    early=_prepare(gate,record)
    if early:return early
    if record.get('native_keyboard') is not True: return _result(gate,'UNKNOWN',['Dialog evidence does not establish keyboard interaction.'],source_binding=record.get('source_binding'))
    required=('dialog_role','dialog_accessible_name','expected_dialog_name','initial_focus_inside','dismissal_key','dismissed_by_keyboard','focus_return_target','invoker_target','keyboard_trace_digest','tree_capture_digest')
    if any(record.get(k) in (None,'') for k in required): return _result(gate,'NOT_RUN',['Dialog name/focus/dismissal trace is incomplete.'],source_binding=record.get('source_binding'))
    if record['dialog_role']!='dialog': return _result(gate,'FAIL',['Overlay does not expose the dialog role.'],source_binding=record.get('source_binding'))
    if record['dismissal_key'] not in ('Escape','Enter','Space'): return _result(gate,'UNKNOWN',['Dialog dismissal was not evidenced by an appropriate native keyboard key.'],source_binding=record.get('source_binding'))
    if any(not isinstance(record[k],str) or not _DIGEST.fullmatch(record[k]) for k in ('keyboard_trace_digest','tree_capture_digest')): return _result(gate,'UNKNOWN',['Dialog keyboard or accessibility-tree evidence is unbound.'],source_binding=record.get('source_binding'))
    failures=[]
    if record['dialog_accessible_name']!=record['expected_dialog_name']: failures.append('Dialog accessible name does not match its purpose.')
    if record['initial_focus_inside'] is not True: failures.append('Initial focus did not enter the dialog.')
    if record['dismissed_by_keyboard'] is not True: failures.append('Dialog was not operable/dismissable by keyboard.')
    if record['focus_return_target']!=record['invoker_target']: failures.append('Focus was not restored to the dialog invoker.')
    return _result(gate,'FAIL' if failures else 'PASS',failures,source_binding=record.get('source_binding'),evidence={'dialog_name':record['dialog_accessible_name'],'focus_return_target':record['focus_return_target']})


def evaluate_skip_link(record: object) -> dict:
    gate='A11Y_SKIP_LINK'
    early=_prepare(gate,record)
    if early:return early
    if record.get('native_keyboard') is not True: return _result(gate,'UNKNOWN',['Evidence does not establish keyboard focus of the skip link.'],source_binding=record.get('source_binding'))
    if not isinstance(record.get('keyboard_trace_digest'),str) or not _DIGEST.fullmatch(record['keyboard_trace_digest']): return _result(gate,'UNKNOWN',['Native keyboard trace is missing or unbound.'],source_binding=record.get('source_binding'))
    if record.get('transition_settled') is not True: return _result(gate,'UNKNOWN',['Skip-link reveal transition did not settle.'],source_binding=record.get('source_binding'))
    if not isinstance(record.get('viewport'),dict) or not isinstance(record.get('rect'),dict): return _result(gate,'NOT_RUN',['Viewport/element geometry evidence is missing.'],source_binding=record.get('source_binding'))
    r=record['rect'];v=record['viewport']
    fields=('x','y','width','height');
    if any(not _finite_number(r.get(k)) for k in fields) or any(not _finite_number(v.get(k)) for k in ('width','height')) or v.get('width',0)<=0 or v.get('height',0)<=0 or r.get('width',0)<0 or r.get('height',0)<0:
        return _result(gate,'UNKNOWN',['Skip-link geometry is malformed.'],source_binding=record.get('source_binding'))
    intersects=r['x']<v['width'] and r['y']<v['height'] and r['x']+r['width']>0 and r['y']+r['height']>0
    visible=record.get('visible') is True and record.get('focus_visible') is True and record.get('opacity',0)>0
    opacity=record.get('opacity')
    if not _finite_number(opacity) or not 0<=opacity<=1: return _result(gate,'UNKNOWN',['Skip-link opacity is missing or invalid.'],source_binding=record.get('source_binding'))
    if not intersects or not visible or opacity<=0:return _result(gate,'FAIL',['Skip link is not visibly available within the viewport on keyboard focus.'],source_binding=record.get('source_binding'))
    continuity = record.get('state_continuity')
    if isinstance(continuity, dict):
        continuity = dict(continuity)
        continuity.setdefault('source_binding', record.get('source_binding'))
    state_result = navigation_gates.evaluate_navigation_continuity(continuity)
    if state_result.get('status') != 'PASS':
        return _result(gate, state_result.get('status', 'UNKNOWN'), state_result.get('reasons', ['state continuity is unresolved']),
                       source_binding=record.get('source_binding'), evidence={'viewport':v,'rect':r,'state_continuity':state_result})
    return _result(gate,'PASS',[],source_binding=record.get('source_binding'),evidence={'viewport':v,'rect':r,'state_continuity':state_result.get('evidence')})
