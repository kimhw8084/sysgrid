"""Optional browser probe. NOT inherently read-only: GET requests and DOM scripts may change state.

Default mode blocks mutating HTTP methods and interaction actions; enable them explicitly
only against separately authorized, disposable non-production test data. Never call it
a release qualification, accessibility certification or independent proof by itself.
"""
from __future__ import annotations
import hashlib,json,os,sys,re,shutil,math
from pathlib import Path
from urllib.parse import urlparse,urljoin
from ipaddress import ip_address
from datetime import datetime,timezone

ALLOWED_ACTIONS={'click','fill','press','expect_visible','expect_text','expect_value','wait_for'}
ACTIVE_ACTIONS=frozenset({'click','fill','press'})
SAFE_HTTP_METHODS=frozenset({'GET','HEAD','OPTIONS'})

def _loopback_host(host):
    if not host:return False
    if host.lower()=='localhost':return True
    try:return ip_address(host).is_loopback and host in ('127.0.0.1','::1')
    except ValueError:return False

def _origin(raw):
    if not isinstance(raw,str):raise ValueError('Origin must be a string')
    u=urlparse(raw)
    if u.scheme not in ('http','https') or not u.hostname or u.username is not None or u.password is not None or u.path not in ('','/') or u.query or u.fragment or u.params:
        raise ValueError('Allowed origins must be bare HTTP(S) origins without credentials, paths, queries or fragments')
    try:port=u.port
    except ValueError:raise ValueError('Invalid origin port') from None
    # Normalize scheme and host while retaining explicit port; do not conflate localhost and remote hosts.
    host=('['+u.hostname.lower()+']') if ':' in u.hostname else u.hostname.lower()
    return u.scheme+'://'+host+(':'+str(port) if port is not None else ''),u.hostname.lower()


def sha256(path:Path):return hashlib.sha256(path.read_bytes()).hexdigest()

def _parse_color(color):
    m=re.fullmatch(r'rgba?\(([^)]+)\)',color.strip())
    if not m:return None
    v=[p.strip() for p in m.group(1).replace(',',' ').replace('/',' ').split()]
    if len(v)<3:return None
    try:
        rgb=[]
        for n in v[:3]:rgb.append(int(round(float(n.rstrip('%')) * (2.55 if '%' in n else 1))))
        alpha=float(v[3]) if len(v)>3 else 1.0
        if alpha<.999 or any(x<0 or x>255 for x in rgb):return None
        return rgb
    except ValueError:return None

def contrast_ratio(fg,bg):
    def lum(rgb):
        def s(x):
            x=x/255
            return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4
        return sum(s(x)*w for x,w in zip(rgb,[.2126,.7152,.0722]))
    a,b=sorted((lum(fg),lum(bg)),reverse=True)
    return (a+.05)/(b+.05)

def _validate_spec(spec,allow_remote=False,allow_interactions=False,allow_writes=False):
    if not isinstance(spec,dict) or not isinstance(spec.get('routes'),list) or not spec['routes']:
        raise ValueError('routes must be a non-empty array')
    u=urlparse(spec.get('base_url',''))
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password:
        raise ValueError('base_url must be a valid HTTP(S) address')
    base_origin,base_host=_origin(f'{u.scheme}://{u.netloc}')
    if not allow_remote and not _loopback_host(base_host):
        raise ValueError('Only loopback local apps allowed by default; remote requires explicit --allow-remote')
    raw_allow=spec.get('allowed_origins') or [base_origin]
    if not isinstance(raw_allow,list) or not raw_allow:
        raise ValueError('allowed_origins must be a nonempty array')
    parsed=[_origin(o) for o in raw_allow]
    if not allow_remote and any(not _loopback_host(host) for _,host in parsed):
        raise ValueError('Remote allowed_origins require explicit --allow-remote')
    allow={origin for origin,_ in parsed}
    if base_origin not in allow:raise ValueError('base_url origin must be in allowed_origins')
    if allow_writes and not allow_interactions:
        raise ValueError('--allow-writes requires --allow-interactions and isolated non-production approval')
    for route in spec['routes']:
        path=route.get('path','')
        if not isinstance(path,str) or not path.startswith('/') or path.startswith('//'):
            raise ValueError('route.path must be an absolute path, not an external URL')
        if not isinstance(route.get('name'),str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',route['name']):
            raise ValueError('Route name must be safe for filenames')
        vp=route.get('viewport',{})
        if not (isinstance(vp.get('width'),int) and 200<=vp['width']<=5000 and isinstance(vp.get('height'),int) and 200<=vp['height']<=5000):
            raise ValueError('Missing/invalid viewport dimensions')
        for a in route.get('actions',[]):
            if not isinstance(a,dict) or a.get('type') not in ALLOWED_ACTIONS:raise ValueError('Unsupported action')
            if a['type'] in ACTIVE_ACTIONS and not allow_interactions:
                raise ValueError('Interactive click/fill/press requires explicit --allow-interactions; can modify UI or server state')
            if not isinstance(a.get('selector'),str) or not a['selector']:raise ValueError('Action must have selector')
        measurements = route.get('measure',{})
        if not isinstance(measurements,dict):raise ValueError('measure must be an object')
        for label,selector in measurements.items():
            if not isinstance(label,str) or not isinstance(selector,str) or not selector:raise ValueError('Invalid measurement selector')
        for field in ('forbid_internal_overflow','forbid_internal_vertical_overflow'):
            values=route.get(field,[])
            if not isinstance(values,list) or any(not isinstance(v,str) or v not in measurements for v in values):
                raise ValueError(field+' must contain declared measurement labels')
        for field in ('vertical_overflow_tolerance','horizontal_overflow_tolerance'):
            tolerance=route.get(field,2)
            if not isinstance(tolerance,(int,float)) or isinstance(tolerance,bool) or not math.isfinite(tolerance) or not (0 <= tolerance <= 1000):
                raise ValueError(field+' must be a finite nonnegative numeric tolerance')
    return allow


def _request_decision(url: str, method: str, allow_origins: set[str], allow_writes: bool = False) -> str | None:
    """Return the reason to abort, or None. Called for every intercepted HTTP request."""
    parsed=urlparse(url)
    try: origin,_=_origin(f'{parsed.scheme}://{parsed.netloc}')
    except ValueError:return 'blocked request with invalid origin'
    if origin not in allow_origins:return 'blocked request to unapproved origin: '+origin
    if str(method).upper() not in SAFE_HTTP_METHODS and not allow_writes:
        return 'blocked potentially mutating HTTP method: '+str(method).upper()
    return None


def image_compare(actual:Path,baseline:Path,pixel_tolerance=0.0):
    try:from PIL import Image,ImageChops
    except ImportError: return {'status':'BLOCKED_PILLOW_REQUIRED_FOR_SCREENSHOT_DIFF'}
    if not baseline.is_file():return {'status':'BLOCKED_BASELINE_NOT_PRESENT'}
    with Image.open(actual) as a,Image.open(baseline) as b:
        if a.size!=b.size:return {'status':'FAIL_SIZE_MISMATCH','actual':a.size,'baseline':b.size}
        a=a.convert('RGB');b=b.convert('RGB');diff=ImageChops.difference(a,b)
        # No numpy dependency: diff pixels contain (r,g,b) integers
        n=0;total=a.width*a.height
        for pix in (diff.get_flattened_data() if hasattr(diff,'get_flattened_data') else diff.getdata()):
            if max(pix)>pixel_tolerance*255:n+=1
        return {'status':'MEASURED','fraction_differing_pixels':round(n/total,8),'pixel_tolerance':pixel_tolerance,'baseline_sha256':sha256(baseline)}


def _action(page,a):
    t=a['type'];s=a['selector'];loc=page.locator(s).first
    if t=='click':loc.click(timeout=10000)
    elif t=='fill':loc.fill(str(a.get('value','')),timeout=10000)
    elif t=='press':loc.press(a.get('key','Enter'),timeout=10000)
    elif t=='wait_for':loc.wait_for(state=a.get('state','visible'),timeout=10000)
    elif t=='expect_visible':
        if not loc.is_visible():raise AssertionError('Expected visible: '+s)
    elif t=='expect_text':
        if a.get('text','') not in loc.inner_text():raise AssertionError('Text not found: '+s)
    elif t=='expect_value':
        if loc.input_value()!=a.get('value'):raise AssertionError('Incorrect input value: '+s)


def _vertical_clipping_reason(measurement: dict, label: str, route: dict) -> str | None:
    """Detect vertical loss for measured elements, not legitimate page scrolling.

    CSS hidden/clip with overflowing contents is clipped; auto/scroll is intentional
    unless the route explicitly forbids an internally scrolling region. Never treat
    the document's natural vertical scrolling as clipping by itself.
    """
    tolerance = float(route.get('vertical_overflow_tolerance', 2))
    scroll = measurement.get('scrollHeight')
    client = measurement.get('clientHeight')
    if not isinstance(scroll, (int,float)) or not isinstance(client,(int,float)):
        return None  # separate measurement error already recorded upstream
    if scroll <= client + tolerance:
        return None
    overflow_y = str(measurement.get('overflowY', '')).lower()
    if overflow_y in ('hidden', 'clip'):
        return 'vertical clipped content: ' + label
    if label in route.get('forbid_internal_vertical_overflow', []):
        return 'vertical internal overflow forbidden: ' + label
    return None


def _require_websocket_interception(context):
    """Install socket-denial routing before any page exists; refuse unsupported versions.

    Playwright HTTP route does not cover WebSockets. An absent or broken socket
    routing capability must never be reported as blocking WebSockets successfully.
    """
    route_sockets = getattr(context, 'route_web_socket', None)
    if not callable(route_sockets):
        return 'BLOCKED_WEBSOCKET_ROUTING_UNAVAILABLE'
    try:
        route_sockets('**/*', lambda socket: socket.close())
    except Exception:
        return 'BLOCKED_WEBSOCKET_ROUTING_SETUP_FAILED'
    return None


def _audit_route(browser,spec,route,out_dir,allow_origins,base_url,fixture_html=None,*,allow_writes=False):
    context=browser.new_context(viewport=route['viewport'],device_scale_factor=route.get('device_scale_factor',1),service_workers='block')
    failures=[];warnings=[];evidence={'name':route['name'],'path':route['path'],'viewport':route['viewport'],'actions':[],'measurements':{},'contrast':[],'focus':[], 'web_socket_interception':'NOT_INSTALLED'}
    capability_failure = _require_websocket_interception(context)
    if capability_failure:
        # No page, request, or fixture is created when socket interception is unsafe.
        context.close()
        evidence.update({'failures':[capability_failure],'warnings':[], 'status':'BLOCKED',
                         'web_socket_interception':'UNAVAILABLE_NO_NAVIGATION',
                         'screenshot_comparison':{'status':'NOT_RUN_BROWSER_BLOCKED'}})
        return evidence
    evidence['web_socket_interception']='INSTALLED_BEFORE_NAVIGATION'
    def allow(route_obj):
        req=route_obj.request
        reason=_request_decision(req.url,req.method,allow_origins,allow_writes)
        if reason:
            route_obj.abort();failures.append(reason)
        else:route_obj.continue_()
    try:
        # Interception must be active before page allocation or navigation.
        context.route('**/*', allow)
        page=context.new_page()
        if fixture_html is not None:
            page.set_content(fixture_html,wait_until='domcontentloaded')
        else:
            page.goto(urljoin(base_url,route['path']),wait_until='domcontentloaded',timeout=20000)
        if route.get('wait_for'):
            page.locator(route['wait_for']).first.wait_for(state='visible',timeout=15000)
        for action in route.get('actions',[]):
            try:_action(page,action);evidence['actions'].append({'type':action['type'],'selector':action['selector'],'status':'EXECUTED'})
            except Exception as exc:failures.append('action '+action['type']+' '+action['selector']+': '+type(exc).__name__)
        # Allow dispatched events/fetches to reach the interceptor before the result is finalized.
        if route.get('actions'):
            page.wait_for_timeout(250)
        # Relevant DOM measurements from actual rendered browser.
        for key,selector in route.get('measure',{}).items():
            loc=page.locator(selector).first
            try:
                if loc.count()==0:failures.append('missing measured selector '+key);continue
                m=loc.evaluate('''el=>{const r=el.getBoundingClientRect(),c=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,fontSize:c.fontSize,visibility:c.visibility,overflow:c.overflow,overflowX:c.overflowX,overflowY:c.overflowY}}''')
                evidence['measurements'][key]=m
                if m['clientWidth']>=0 and m['scrollWidth']>m['clientWidth']+float(route.get('horizontal_overflow_tolerance',2)) and key in route.get('forbid_internal_overflow',[]):failures.append('horizontal clipping/overflow: '+key)
                vertical = _vertical_clipping_reason(m,key,route)
                if vertical: failures.append(vertical)
            except Exception as exc:failures.append('measurement '+key+': '+type(exc).__name__)
        widths=page.evaluate('''()=>({documentScrollWidth:document.documentElement.scrollWidth,documentClientWidth:document.documentElement.clientWidth,bodyScrollWidth:document.body?.scrollWidth||0,bodyClientWidth:document.body?.clientWidth||0})''')
        evidence['document_overflow']=widths
        if widths['documentScrollWidth']>widths['documentClientWidth']+float(route.get('horizontal_overflow_tolerance',2)):
            failures.append('document horizontal overflow')
        for cfg in route.get('contrast',[]):
            sel=cfg['selector'];loc=page.locator(sel).first
            if loc.count()==0:failures.append('contrast missing selector '+sel);continue
            colors=loc.evaluate(r'''el=>{let s=getComputedStyle(el),n=el,bg='unknown',complex=false;
              while(n){const c=getComputedStyle(n);if(c.backgroundImage!=='none'){complex=true;break}
                const v=c.backgroundColor;if(v && !/rgba\([^)]*,\s*0(?:\.0+)?\)/.test(v)){bg=v;break}
                n=n.parentElement;}
              return {fg:s.color,bg,complexBackground:complex}}''')
            a,b=_parse_color(colors['fg']),_parse_color(colors['bg'])
            item={'selector':sel,**colors}
            if a is None or b is None or colors.get('complexBackground'):
                item.update({'status':'UNKNOWN_COMPLEX_COLOR','note':'Transparency, gradients and ancestor backgrounds require external evaluation'})
                failures.append('unresolved contrast: '+sel)
            else:
                ratio=contrast_ratio(a,b);item.update({'ratio':round(ratio,3),'min_ratio':cfg.get('min_ratio',4.5)})
                if ratio+1e-5<cfg.get('min_ratio',4.5):failures.append('contrast below declared threshold: '+sel)
                item['status']='MEASURED'
            evidence['contrast'].append(item)
        # Explicit keyboard focus route assertion.
        if route.get('focus_start'):
            page.locator(route['focus_start']).first.focus()
        for entry in route.get('focus_sequence',[]):
            key=entry.get('key','Tab');expected=entry['selector']
            page.keyboard.press(key)
            matches=page.evaluate('(sel)=>document.activeElement?.matches(sel)===true',expected)
            evidence['focus'].append({'key':key,'expected_selector':expected,'matched':matches})
            if not matches:failures.append('focus sequence mismatch: '+expected)
        screenshot_path=out_dir/(route['name']+'.png')
        page.screenshot(path=str(screenshot_path),full_page=bool(route.get('full_page',False)))
        evidence['screenshot']={'path':screenshot_path.name,'sha256':sha256(screenshot_path)}
        if route.get('screenshot_baseline'):
            baseline=Path(route['screenshot_baseline']).expanduser().resolve()
            if baseline==screenshot_path.resolve() or baseline.is_relative_to(out_dir.resolve()):
                res={'status':'BLOCKED_BASELINE_INSIDE_OUTPUT_DIR'}
            elif not route.get('screenshot_baseline_sha256'):
                res={'status':'BLOCKED_BASELINE_DIGEST_REQUIRED'}
            elif not baseline.is_file() or sha256(baseline)!=route['screenshot_baseline_sha256']:
                res={'status':'BLOCKED_BASELINE_DIGEST_MISMATCH'}
            else:
                res=image_compare(screenshot_path,baseline,route.get('pixel_tolerance',0))
            evidence['screenshot_comparison']=res
            if res['status']!='MEASURED':failures.append(res['status'])
            else:
                limit=route.get('max_differing_fraction',0)
                if res['fraction_differing_pixels']>limit:failures.append('screenshot difference exceeds declared tolerance')
        else:
            evidence['screenshot_comparison']={'status':'NOT_RUN_NO_APPROVED_BASELINE'}
    except Exception as exc:
        failures.append('browser navigation/probe: '+type(exc).__name__+': '+str(exc)[:200])
    finally:context.close()
    evidence.update({'failures':failures,'warnings':warnings,'status':'FAIL' if failures else 'EVIDENCE_CAPTURED_NOT_INDEPENDENTLY_VERIFIED'})
    return evidence


def _baseline_preflight_failure(route:dict, out_dir:Path) -> str | None:
    """Reject invalid/mutable baseline locations before any browser is launched.

    The same check is retained inside the renderer as defense in depth.
    A baseline created in the capture output directory can never establish an
    independent regression comparison, regardless of browser availability.
    """
    raw=route.get('screenshot_baseline')
    if not raw:
        return None
    baseline=Path(raw).expanduser().resolve()
    output=out_dir.resolve()
    if baseline.is_relative_to(output):
        return 'BLOCKED_BASELINE_INSIDE_OUTPUT_DIR'
    if not route.get('screenshot_baseline_sha256'):
        return 'BLOCKED_BASELINE_DIGEST_REQUIRED'
    if not baseline.is_file() or sha256(baseline)!=route['screenshot_baseline_sha256']:
        return 'BLOCKED_BASELINE_DIGEST_MISMATCH'
    return None


def _write_report(out_dir:Path, report:dict) -> None:
    (out_dir/'report.json').write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')


def run(spec:dict,output:Path,allow_remote=False,*,allow_interactions=False,allow_writes=False,_internal_fixture_html=None):
    allow_origins=_validate_spec(spec,allow_remote,allow_interactions,allow_writes)
    output.mkdir(parents=True,exist_ok=True)
    report={'schema':'golden-uiux-browser-evidence-1','created_utc':datetime.now(timezone.utc).isoformat(),'declared_source_revision':spec.get('source_revision','UNVERIFIED'),
      'profile_digest':spec.get('profile_digest','UNVERIFIED'),'catalog_digest':spec.get('catalog_digest','UNVERIFIED'),
      'source_binding_status':'FIXTURE_NOT_APPLICATION' if _internal_fixture_html is not None else 'DECLARED_NOT_INDEPENDENTLY_VERIFIED','approval_status':'NOT_APPROVED',
      'note':'Browser execution is NOT intrinsically read-only; even safe-method GET or JS can change state. Use an isolated test deployment. Screenshots/DOM cannot certify WCAG or production.',
      'network_policy':{'allowed_origins':sorted(allow_origins),'allow_remote':allow_remote,'allow_interactions':allow_interactions,'allow_mutating_http':allow_writes,'safe_methods_only':not allow_writes,'web_sockets':'PENDING_CAPABILITY_CHECK'},'routes':[]}
    # Baseline ownership and expected-digest checks MUST precede browser import
    # and launch. A bad baseline must fail identically on machines with or without
    # Playwright/Chromium and must not create an application page.
    for route in spec['routes']:
        reason = _baseline_preflight_failure(route, output)
        if reason:
            report['routes'].append({
                'name':route['name'], 'path':route['path'], 'status':'FAIL',
                'failures':[reason], 'warnings':[],
                'web_socket_interception':'NOT_ATTEMPTED_PRENAVIGATION_VALIDATION',
                'screenshot_comparison':{'status':reason},
            })
    if report['routes']:
        report['status']='FAIL'
        report['network_policy']['web_sockets']='NOT_ATTEMPTED_PRENAVIGATION_VALIDATION'
        _write_report(output, report)
        return report
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        report.update({'status':'BLOCKED_PLAYWRIGHT_NOT_INSTALLED',
             'message':'Approved local Playwright Python package and Chromium are required to collect browser evidence.'})
        report['network_policy']['web_sockets']='NOT_ATTEMPTED_BROWSER_UNAVAILABLE'
        _write_report(output,report)
        return report
    with sync_playwright() as pw:
        exe=spec.get('browser_executable') or shutil.which('chromium') or shutil.which('google-chrome')
        kwargs={'headless':True}
        if exe:
            if not Path(exe).is_file():raise ValueError('Selected Chromium executable does not exist')
            kwargs['executable_path']=exe
        try:browser=pw.chromium.launch(**kwargs)
        except Exception as exc:
            report.update({'status':'BLOCKED_BROWSER_NOT_INSTALLED',
               'message':type(exc).__name__+': approved Chromium/Playwright browser binaries required'})
            report['network_policy']['web_sockets']='NOT_ATTEMPTED_BROWSER_UNAVAILABLE'
            _write_report(output,report)
            return report
        try:
            for route in spec['routes']:
                report['routes'].append(_audit_route(browser,spec,route,output,allow_origins,spec['base_url'],fixture_html=_internal_fixture_html,allow_writes=allow_writes))
        finally:browser.close()
    # Never report socket blocking as effective unless routing was installed
    # successfully for every page *before* that page could navigate.
    reports = report['routes']
    installed = bool(reports) and all(r.get('web_socket_interception')=='INSTALLED_BEFORE_NAVIGATION' for r in reports)
    report['network_policy']['web_sockets'] = 'BLOCKED_BY_INSTALLED_ROUTING' if installed else 'UNAVAILABLE_NO_NAVIGATION_ON_AFFECTED_ROUTE'
    report['status']='BLOCKED' if any(x['status']=='BLOCKED' for x in reports) else ('FAIL' if any(x['status']=='FAIL' for x in reports) else 'EVIDENCE_COLLECTED_REVIEW_REQUIRED')
    _write_report(output,report)
    return report
