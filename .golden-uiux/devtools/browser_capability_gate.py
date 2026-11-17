"""Required opt-in browser runtime gate. Runs only an isolated local in-memory HTML fixture.

Never equate this PASS with application-level browser qualification, and never
perform navigation to a real application from this script.
"""
from __future__ import annotations
import json,sys,argparse,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from golden_uiux.browser_audit import run

HTML="""<!DOCTYPE html><html><head><style>body{color:rgb(0,0,0);background:rgb(255,255,255)} #test-panel{width:200px;height:60px}</style></head><body><main><h1>Browser capability test fixture</h1><div id="test-panel">Safe rendered content</div></main></body></html>"""

def main(argv=None):
    p=argparse.ArgumentParser(description='Require real Chromium and WebSocket-route protection for isolated fixture')
    p.add_argument('--output',help='Evidence folder; default disposable temporary directory')
    args=p.parse_args(argv)
    spec={'base_url':'http://127.0.0.1:3000','routes':[
        {'name':'capability','path':'/','viewport':{'width':900,'height':600},
         'measure':{'test-panel':'#test-panel'},
         'contrast':[{'selector':'#test-panel','min_ratio':4.5}],
         'focus_start':None}]}
    if args.output:
        out=Path(args.output)
        report=run(spec,out,_internal_fixture_html=HTML)
    else:
        with tempfile.TemporaryDirectory() as td:
            report=run(spec,Path(td),_internal_fixture_html=HTML)
    routes=report.get('routes') or []
    good=(report.get('status')=='EVIDENCE_COLLECTED_REVIEW_REQUIRED'
          and len(routes)==1 and routes[0].get('web_socket_interception')=='INSTALLED_BEFORE_NAVIGATION'
          and routes[0].get('measurements',{}).get('test-panel',{}).get('width')==200
          and len(routes[0].get('contrast',[]))==1 and not routes[0].get('failures'))
    status='PASS_BROWSER_RUNTIME_ONLY_NOT_APPLICATION_QUALIFIED' if good else 'BLOCKED_BROWSER_RUNTIME_UNQUALIFIED'
    print(json.dumps({'status':status,'browser_report_status':report.get('status'),
        'reason':report.get('message') or [r.get('failures',[]) for r in routes],
        'scope':'isolated in-memory fixture only, no SysGrid coverage',
        'application_browser_gate':'NOT_RUN',
        'executable_gate_satisfied':bool(good)},indent=2))
    return 0 if good else 3

if __name__=='__main__':raise SystemExit(main())
