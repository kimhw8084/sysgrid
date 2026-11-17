"""Small read-only Model Context Protocol stdio server, legacy 2025-06-18 protocol.

No third-party libraries or network requests; exactly one JSON-RPC message per line.
The server never writes files, changes Git state or grants approval.
"""
import json
import os
import sys
import stat
from . import __version__
from . import core

PROTOCOL = '2025-06-18'
TOOLS = [
 {
  'name':'uiux_list_patterns','description':'List 14 candidate UI pattern IDs and short summaries; no permissions or test claims.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{},'additionalProperties':False}
 },
 {
  'name':'uiux_get_pattern','description':'Read the selected P01-P14 design contract (one at a time). Returns proposed guidance, not authority.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{'pattern_id':{'type':'string','enum':list(core.VALID_IDS)}},'required':['pattern_id'],'additionalProperties':False}
 },
 {
  'name':'uiux_route_task','description':'Route from structured product intent, workflow steps and component needs. Task keywords are diagnostic only; irrelevant pattern injection is rejected.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{'task':{'type':'string','minLength':1,'maxLength':8000},'intent_spec':{'type':'object','properties':{'intent_id':{'type':'string'},'workflow_steps':{'type':'array','items':{'type':'string'}},'component_needs':{'type':'array','items':{'type':'string'}},'constraints':{'type':'array','items':{'type':'string'}},'scope_mode':{'enum':['isolated_prototype','existing_product_change','new_product_exploration']}},'required':['intent_id','workflow_steps','component_needs','constraints'],'additionalProperties':False},'explicit_patterns':{'type':'array','items':{'type':'string','enum':list(core.VALID_IDS)}}},'required':['task','intent_spec'],'additionalProperties':False}
 },
 {
  'name':'uiux_feature_intake','description':'Read-only structured feature intake and existing component lookup; never grants source/Git privileges.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{'brief':{'type':'object'}},'required':['brief'],'additionalProperties':False}
 },
 {
  'name':'uiux_check_plan','description':'Statically check plan completeness; never self-certifies compliance or source write authority.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{'plan':{'type':'object'}},'required':['plan'],'additionalProperties':False}
 },
 {
  'name':'uiux_audit_proof_metadata','description':'Check untrusted proof metadata and fail closed until external CI/reviewer validates.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{'proofs':{'type':'array','items':{'type':'object'}},'source_revision':{'type':'string'}},'required':['proofs'],'additionalProperties':False}
 },
 {
  'name':'uiux_compare_geometry','description':'Compare numeric geometry snapshots for context mismatch or unapproved expansion; not a full visual test.',
  'annotations':{'readOnlyHint':True,'destructiveHint':False},
  'inputSchema':{'type':'object','properties':{'before':{'type':'object'},'after':{'type':'object'}},'required':['before','after'],'additionalProperties':False}
 }
]

def load_profile():
    """Load only the bounded regular local profile, never a symlink or outside file.

    Reject unresolved/escaped paths; open the final component O_NOFOLLOW and verify
    inode identity to prevent a check-to-open symlink swap. On platforms without a
    secure no-follow open, omit the profile rather than risk disclosing its contents.
    The profile remains untrusted advisory data, not independently approved policy.
    """
    path = core.ROOT / 'project_profile.json'
    max_bytes = 1_000_000
    try:
        # Only the fixed package-root profile is allowed, never an arbitrary MCP path.
        trusted_root = core.ROOT.resolve(strict=True)
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(trusted_root):
            return None
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size > max_bytes:
            return None
        if not hasattr(os, 'O_NOFOLLOW'):
            return None  # unsupported secure opening; fail closed, not a weaker fallback
        flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, 'rb') as handle:
            opened = os.fstat(handle.fileno())
            if (not stat.S_ISREG(opened.st_mode) or opened.st_size > max_bytes
                or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)):
                return None
            raw = handle.read(max_bytes + 1)
        if len(raw) > max_bytes:
            return None
        parsed = json.loads(raw.decode('utf-8'))
        return parsed if isinstance(parsed, dict) else None
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        return None


def tool_call(name, args):
    if not isinstance(args, dict): raise ValueError('Tool arguments must be a JSON object')
    permitted = next((t for t in TOOLS if t['name']==name),None)
    if not permitted: raise ValueError('Tool is unknown')
    unknown = set(args)-set(permitted['inputSchema']['properties'])
    if unknown: raise ValueError('Unexpected tool arguments: '+', '.join(sorted(unknown)))
    missing = set(permitted['inputSchema'].get('required',[]))-set(args)
    if missing: raise ValueError('Missing required arguments: '+', '.join(sorted(missing)))
    if name=='uiux_list_patterns':return core.patterns_index()
    if name=='uiux_get_pattern':return core.get_pattern(args['pattern_id'])
    if name=='uiux_route_task':return core.route_task(args['task'],load_profile(),args.get('explicit_patterns'),args['intent_spec'])
    if name=='uiux_feature_intake':return core.intake_brief(args['brief'],load_profile())
    if name=='uiux_check_plan':return core.check_plan(args['plan'],load_profile())
    if name=='uiux_audit_proof_metadata':return core.proof_audit(args['proofs'],args.get('source_revision'),core.catalog_digest())
    if name=='uiux_compare_geometry':return core.geometry_compare(args['before'],args['after'])
    raise ValueError('Unsupported tool')


def dispatch(request):
    if not isinstance(request,dict) or request.get('jsonrpc')!='2.0':
        return {'jsonrpc':'2.0','id':request.get('id') if isinstance(request,dict) else None,'error':{'code':-32600,'message':'Invalid Request'}}
    if 'id' not in request:
        # All notifications are ignored; no server-to-client requests.
        return None
    rid=request['id']
    method=request.get('method')
    params=request.get('params',{})
    if not isinstance(params,dict):
        return {'jsonrpc':'2.0','id':rid,'error':{'code':-32602,'message':'params must be an object'}}
    try:
        if method=='initialize':
            result={'protocolVersion':PROTOCOL,'capabilities':{'tools':{'listChanged':False},'resources':{'listChanged':False}},'serverInfo':{'name':'golden-uiux-readonly','version':__version__},'instructions':'Read-only candidate design specifications; no file writes, company approvals or actual test PASS. Load only needed contracts.'}
        elif method=='ping': result={}
        elif method=='tools/list': result={'tools':TOOLS}
        elif method=='tools/call':
            name=params.get('name')
            if not isinstance(name,str):raise ValueError('Tool name must be a string')
            value=tool_call(name,params.get('arguments',{}))
            result={'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False,separators=(',',':'))}],'structuredContent':value,'isError':False}
        elif method=='resources/list':
            result={'resources':[{'uri':'uiux://index','name':'Pattern index','mimeType':'application/json'},{'uri':'uiux://source-hashes','name':'Catalog identity','mimeType':'application/json'}]}
        elif method=='resources/read':
            uri=params.get('uri')
            if uri=='uiux://index':value=core.patterns_index()
            elif uri=='uiux://source-hashes':value={'catalog_digest':core.catalog_digest(),'package_version':__version__}
            else: raise ValueError('Unknown resource URI')
            result={'contents':[{'uri':uri,'mimeType':'application/json','text':json.dumps(value,ensure_ascii=False,separators=(',',':'))}]}
        else: return {'jsonrpc':'2.0','id':rid,'error':{'code':-32601,'message':'Method not found'}}
        return {'jsonrpc':'2.0','id':rid,'result':result}
    except (TypeError,KeyError,ValueError) as exc:
        # Avoid exposing private source details or arbitrary filesystem paths.
        if method=='tools/call':
            return {'jsonrpc':'2.0','id':rid,'result':{'content':[{'type':'text','text':'Invalid tool request: '+str(exc)}],'isError':True}}
        return {'jsonrpc':'2.0','id':rid,'error':{'code':-32602,'message':str(exc)}}


def main():
    for raw in sys.stdin:
        if len(raw)>2_000_000:
            print(json.dumps({'jsonrpc':'2.0','id':None,'error':{'code':-32600,'message':'Oversized message'}}),flush=True)
            continue
        try:
            msg=json.loads(raw)
            response=dispatch(msg)
        except (json.JSONDecodeError,UnicodeError):
            response={'jsonrpc':'2.0','id':None,'error':{'code':-32700,'message':'Parse error'}}
        except Exception as exc:
            print('MCP internal error: '+type(exc).__name__,file=sys.stderr)
            response={'jsonrpc':'2.0','id':None,'error':{'code':-32603,'message':'Internal error'}}
        if response is not None:
            sys.stdout.write(json.dumps(response,separators=(',',':'),ensure_ascii=False)+'\n')
            sys.stdout.flush()
    return 0

if __name__=='__main__':sys.exit(main())
